/**
 * VPC, one public subnet for the NAT instance, two private subnets for
 * Lambda and RDS, and the security groups that connect them.
 *
 * No interface VPC endpoints. Each costs ~$7/mo per AZ, and the NAT already
 * carries SSM, Secrets Manager and Stripe traffic - which means the NAT is on
 * the cold-start path, not just the checkout path. That's a deliberate
 * tradeoff, not an oversight: endpoints are the first thing to add if the NAT
 * ever becomes the bottleneck.
 *
 * The NAT is a single-AZ SPOF. EC2 simplified automatic recovery is on by
 * default for t4g and covers host failure; `terraform apply -replace`
 * against `module.network.aws_instance.nat` covers the rest.
 */

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ssm_parameter" "nat_ami" {
  # AL2023, arm64 (D2). This SSM path is itself public - not under
  # /dejavu/<env> - so it needs its own apply-role grant (modules/iam-oidc).
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  name_prefix = "dejavu-${var.environment}"
}

# ---------------------------------------------------------------------------
# VPC, subnets, routing
# ---------------------------------------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name_prefix }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = local.name_prefix }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, 0)
  availability_zone = local.azs[0]

  tags = { Name = "${local.name_prefix}-public-a" }
}

# An RDS subnet group requires two AZs even for a single-AZ instance.
resource "aws_subnet" "private" {
  for_each = { for idx, az in local.azs : az => idx }

  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, each.value + 1)
  availability_zone = each.key

  tags = { Name = "${local.name_prefix}-private-${substr(each.key, -1, 1)}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${local.name_prefix}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block           = "0.0.0.0/0"
    network_interface_id = aws_instance.nat.primary_network_interface_id
  }

  tags = { Name = "${local.name_prefix}-private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "lambda" {
  name        = "${local.name_prefix}-lambda"
  description = "Lambda execution ENIs. No ingress - nothing calls a Lambda ENI directly."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name_prefix}-lambda" }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "RDS. Ingress only from the lambda SG."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name_prefix}-rds" }
}

resource "aws_security_group" "nat" {
  name        = "${local.name_prefix}-nat"
  description = "NAT instance. Ingress only from the lambda SG."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name_prefix}-nat" }
}

# Rules are separate resources, not inline blocks, because lambda and rds
# reference each other's SG id - an inline ingress/egress block on both sides
# would be a dependency cycle.

resource "aws_vpc_security_group_egress_rule" "lambda_to_internet_https" {
  security_group_id = aws_security_group.lambda.id
  description       = "SSM, Secrets Manager and Stripe, all HTTPS, all via the NAT"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_rds" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_lambda" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "nat_from_lambda" {
  security_group_id            = aws_security_group.nat.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "nat_to_internet_https" {
  security_group_id = aws_security_group.nat.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# ---------------------------------------------------------------------------
# NAT instance
#
# A hand-written instance plus ~10 lines of user_data (D1), not a third-party
# AMI, on the path that carries Stripe traffic.
# ---------------------------------------------------------------------------

resource "aws_instance" "nat" {
  ami                    = data.aws_ssm_parameter.nat_ami.value
  instance_type          = var.nat_instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.nat.id]

  # Auto-assigned, not an Elastic IP: stopping the instance releases the
  # address and the IPv4 charge with it, and nothing needs the address to be
  # stable.
  associate_public_ip_address = true

  # This instance's whole job is to forward other hosts' traffic.
  source_dest_check = false

  metadata_options {
    http_tokens = "required"
  }

  # No key pair, no SSH, no instance profile - nothing to reach this host or
  # for this host to reach AWS APIs with.

  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    dnf install -y iptables-services
    systemctl enable --now iptables

    echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-ip-forward.conf
    sysctl --system

    # Nitro instances present as ens5, not eth0 - detect the real default-route
    # interface instead of hardcoding it.
    IFACE=$(ip route | awk '/^default/ {print $5; exit}')
    iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE

    # iptables-services ships its own default /etc/sysconfig/iptables, loaded
    # by `systemctl enable --now iptables` above, whose filter table ends
    # with `-A FORWARD -j REJECT`. Enabling ip_forward and adding a NAT rule
    # is not enough on its own - that reject line still catches every
    # forwarded packet before it ever reaches POSTROUTING/MASQUERADE. Found
    # by real EHOSTUNREACH/ETIMEDOUT errors invoking a Lambda through this
    # NAT: the fix needs both an explicit allow for traffic from our VPC and
    # a stateful allow for the replies, inserted ahead of that reject.
    iptables -I FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
    iptables -I FORWARD -s ${var.vpc_cidr} -j ACCEPT
    iptables-save > /etc/sysconfig/iptables
  EOF

  tags = { Name = "${local.name_prefix}-nat" }

  lifecycle {
    # Every new AL2023 AMI release would otherwise plan a NAT replacement.
    ignore_changes = [ami]
  }
}
