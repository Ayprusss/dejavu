variable "environment" {
  type = string
}

variable "parameters" {
  description = "Map of parameter short name to description. Values are set out of band."
  type        = map(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}
