# SSM Parameters for secrets
resource "aws_ssm_parameter" "supabase_url" {
  name  = "/${var.app_name}/supabase_url"
  type  = "SecureString"
  value = "placeholder" # Set actual value manually or via CI/CD

  tags = {
    Name        = "${var.app_name}-supabase-url"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "supabase_key" {
  name  = "/${var.app_name}/supabase_service_role_key"
  type  = "SecureString"
  value = "placeholder" # Set actual value manually or via CI/CD

  tags = {
    Name        = "${var.app_name}-supabase-key"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/${var.app_name}/jwt_secret"
  type  = "SecureString"
  value = "placeholder" # Set actual value manually or via CI/CD

  tags = {
    Name        = "${var.app_name}-jwt-secret"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "redis_url" {
  name  = "/${var.app_name}/redis_url"
  type  = "SecureString"
  value = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"

  tags = {
    Name        = "${var.app_name}-redis-url"
    Environment = var.environment
  }
}

resource "aws_ssm_parameter" "grok_api_key" {
  name  = "/${var.app_name}/grok_api_key"
  type  = "SecureString"
  value = "placeholder" # Set actual value manually or via CI/CD

  tags = {
    Name        = "${var.app_name}-grok-api-key"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "twilio_account_sid" {
  name  = "/${var.app_name}/twilio_account_sid"
  type  = "SecureString"
  value = "placeholder" # Set actual value manually or via CI/CD

  tags = {
    Name        = "${var.app_name}-twilio-account-sid"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "twilio_auth_token" {
  name  = "/${var.app_name}/twilio_auth_token"
  type  = "SecureString"
  value = "placeholder" # Set actual value manually or via CI/CD

  tags = {
    Name        = "${var.app_name}-twilio-auth-token"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [value]
  }
}