resource "google_storage_bucket" "output" {
  name          = "ama-output-${var.project_id}"
  location      = var.region
  force_destroy = true
  uniform_bucket_level_access = true
}
