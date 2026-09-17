variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "nat_instance_type" {
  description = <<-DESC
    t4g.nano is the natural size for a NAT-only box, but this account
    rejected it with "not eligible for Free Tier" - verified via `aws ec2
    describe-instance-types --filters Name=free-tier-eligible,Values=true`,
    which lists t4g.micro (and t4g.small) but not t4g.nano. t4g.micro keeps
    D2's arm64 choice and is free-tier eligible here, likely making this
    line item $0 rather than the ~$3/mo in the cost table, up to the
    account's free-tier hour allowance.
  DESC
  type        = string
  default     = "t4g.micro"
}
