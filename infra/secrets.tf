# Secret value is pushed by deploy.sh (via gcloud) BEFORE terraform runs.
# Terraform only reads the existing secret and manages the IAM binding.
data "google_secret_manager_secret" "gemini_api_key" {
  secret_id  = "gemini-api-key"
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "cloudrun_secret" {
  secret_id = data.google_secret_manager_secret.gemini_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloudrun.email}"
}
