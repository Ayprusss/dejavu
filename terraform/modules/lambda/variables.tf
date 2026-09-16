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
    Git SHA (or other tag) of the images already pushed to ECR before the
    first apply (6.7 step 2). Used only to give the Lambda a valid image_uri
    on creation - every apply after that ignores this argument
    (lifecycle.ignore_changes), because code ships via
    `aws lambda update-function-code`, not Terraform (D5).
  DESC
  type        = string
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
    Number of proxies in front of Express (Function URL -> Lambda Web Adapter
    -> Express). Placeholder until 6.9 determines the real value by
    experiment; 0 (no proxy trusted) is the safe default everywhere else in
    this app, so it stays the default here too rather than guessing a number
    that would silently mis-key the rate limiter.
  DESC
  type        = number
  default     = 0
}
