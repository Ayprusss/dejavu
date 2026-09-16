variable "environment" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "lambda_security_group_id" {
  type = string
}

variable "initial_image_tag" {
  description = <<-DESC
    Tag of the images already pushed to ECR before the first apply (6.7 step
    2). Used only to give the Lambda a valid image_uri on creation - every
    apply after that ignores this argument (lifecycle.ignore_changes),
    because code ships via `aws lambda update-function-code`, not Terraform
    (D5). Defaults to the fixed "bootstrap" tag pushed once, by hand, before
    the first apply - not a git SHA, because CI's `terraform apply
    -auto-approve` (terraform.yml) passes no value for this, and a SHA
    default would go stale on the very next commit while still being
    permanently ignored after creation.
  DESC
  type        = string
  default     = "bootstrap"
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  description = "API function timeout, seconds. Longer than the 3s default - a Stripe call alone can take longer."
  type        = number
  default     = 15
}

variable "migrator_timeout" {
  type    = number
  default = 300
}

variable "reserved_concurrency" {
  description = <<-DESC
    Ceiling on the API function, so concurrency x PG_POOL_MAX=1 can't
    approach max_connections and a flood can't run up a bill. Left unset
    (null) by default: this account's Lambda concurrency quota is 10 total
    (verified via `aws lambda get-account-settings` during 6.5/6.6), and AWS
    refuses any reservation that would leave fewer than 10 unreserved - so
    reserving anything here today would fail the apply. Set this only after
    requesting a quota increase.
  DESC
  type        = number
  default     = null
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type = number
}

variable "db_name" {
  type = string
}

variable "db_secret_arn" {
  type = string
}

variable "cors_origins" {
  type = list(string)
  default = [
    "https://dejavustudio.xyz",
    "https://dejavu-ten.vercel.app",
  ]
}

variable "frontend_url" {
  type    = string
  default = "https://dejavustudio.xyz"
}

variable "trust_proxy" {
  description = <<-DESC
    Confirmed 0 by real experiment in 6.9, not a placeholder: this Function
    URL has no CloudFront or ALB in front of it, and the Lambda Web Adapter
    does not sanitize X-Forwarded-For - a client-supplied header reaches
    Express completely unmodified (verified by sending one and reading it
    back). Any nonzero value here would make app.set('trust proxy', N) trust
    that header, letting a single caller mint a fresh rate-limit bucket per
    request for the price of one header - strictly worse than trusting
    nothing. The real client IP does reach the app, just not through
    Express's trust-proxy mechanism: src/lib/clientIp.js reads it from
    x-amzn-request-context instead, which the adapter provides directly from
    the Lambda event and which a client cannot override (also verified by
    trying).
  DESC
  type        = number
  default     = 0
}
