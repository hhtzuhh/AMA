resource "google_service_account" "cloudrun" {
  account_id   = "ama-cloudrun-sa"
  display_name = "AMA Cloud Run SA"
}

resource "google_storage_bucket_iam_member" "cloudrun_gcs" {
  bucket = google_storage_bucket.output.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloudrun.email}"
}

resource "google_project_iam_member" "cloudrun_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}
