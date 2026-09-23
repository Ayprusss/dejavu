variable "environment" {
  type = string
}

variable "retention_in_days" {
  type    = number
  default = 14
}

variable "enable_alarms" {
  description = <<-DESC
    Creates the SNS topic, its email subscription, and all four 7.7 alarm
    classes when true. Set false to switch an environment's alarms off in
    one place - e.g. a dev environment nobody wants paged for - rather than
    commenting out resources or deleting the module call.
  DESC
  type        = bool
  default     = true
}

variable "alarm_email" {
  description = <<-DESC
    Where alarm notifications (both ALARM and OK) go.

    Like modules/budget's notification_email, this is never committed: the
    repo is public, so an email address in it is a spam magnet. Supply it as
    TF_VAR_alarm_email, which CI reads from the ALARM_EMAIL secret.

    Required, and not blank, when enable_alarms is true. Left null (the
    default) it's only valid when enable_alarms is false, since nothing
    would use it.

    Blank counts as missing because GitHub expands an unset secret to "",
    so TF_VAR_alarm_email is always set in CI. A null-only check let ""
    through the plan, and the apply would then have asked SNS to subscribe
    an empty endpoint, failing partway through. The try() is needed because
    Terraform 1.11 doesn't short-circuit || or &&: a bare trimspace(null)
    errors even when enable_alarms is false.
  DESC
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = !var.enable_alarms || try(trimspace(var.alarm_email), "") != ""
    error_message = "alarm_email must be a non-blank email address when enable_alarms is true. CI reads it from the ALARM_EMAIL repository secret (as TF_VAR_alarm_email), and an unset secret arrives as an empty string: set ALARM_EMAIL, or set enable_alarms = false."
  }
}
