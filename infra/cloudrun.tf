locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/ama-backend/ama-api:latest"
}

resource "google_cloud_run_v2_service" "backend" {
  name     = "ama-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  depends_on = [google_project_service.apis]

  template {
    service_account       = google_service_account.cloudrun.email
    execution_environment = "EXECUTION_ENVIRONMENT_GEN2" # required for GCS FUSE
    timeout               = "600s"
    max_instance_request_concurrency = 4

    scaling {
      min_instance_count = 1 # keep warm for demo; avoid cold starts + session loss
      max_instance_count = 3
    }

    containers {
      image = local.image

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
        cpu_idle = false
      }

      ports {
        container_port = 8080
      }

      env {
        name  = "ENV"
        value = "production"
      }
      env {
        name  = "OUTPUT_DIR"
        value = "/app/output"
      }
      env {
        name  = "MOCK_MODE"
        value = "false"
      }
      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "true"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }
      env {
        name  = "U2NET_HOME"
        value = "/app/.u2net"
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "gcs-output"
        mount_path = "/app/output"
      }
    }

    volumes {
      name = "gcs-output"
      gcs {
        bucket    = google_storage_bucket.output.name
        read_only = false
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
