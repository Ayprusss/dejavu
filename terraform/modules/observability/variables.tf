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

    Required when enable_alarms is true; left null (the default) it's only
    valid when enable_alarms is false, since nothing would use it.
  DESC
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = !var.enable_alarms || var.alarm_email != null
    error_message = "alarm_email is required when enable_alarms is true."
  }
}
