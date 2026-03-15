output "cloud_run_url"  { value = google_cloud_run_v2_service.backend.uri }
output "gcs_bucket"     { value = google_storage_bucket.output.name }
output "image_path"     { value = local.image }
