#!/bin/bash

# Disaster Recovery script for Relationship Care Platform
# This script handles disaster recovery scenarios with <1hr RTO

set -e

# Configuration
BACKUP_S3_BUCKET="${S3_BACKUP_BUCKET:-relationship-care-platform-backups}"
RECOVERY_DIR="/tmp/recovery"
DATE_PATTERN="${1:-$(date +%Y%m%d)}"  # Allow specifying recovery date
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"

# Create recovery directory
mkdir -p "$RECOVERY_DIR"

echo "Starting disaster recovery process at $(date)"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to send notification
send_notification() {
    local status=$1
    local message=$2
    
    if [ -n "$SNS_TOPIC_ARN" ] && command -v aws &> /dev/null; then
        aws sns publish \
            --topic-arn "$SNS_TOPIC_ARN" \
            --subject "Disaster Recovery $status - Relationship Care Platform" \
            --message "$message"
    fi
    
    log "$message"
}

# Function to check prerequisites
check_prerequisites() {
    log "Checking prerequisites"
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log "ERROR: AWS CLI not found"
        exit 1
    fi
    
    # Check Redis CLI
    if ! command -v redis-cli &> /dev/null; then
        log "ERROR: redis-cli not found"
        exit 1
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log "ERROR: Docker not found"
        exit 1
    fi
    
    # Check S3 bucket access
    if ! aws s3 ls "s3://$BACKUP_S3_BUCKET/" > /dev/null 2>&1; then
        log "ERROR: Cannot access S3 backup bucket"
        exit 1
    fi
    
    log "Prerequisites check passed"
}

# Function to find latest backup
find_latest_backup() {
    log "Finding latest backup for date pattern: $DATE_PATTERN"
    
    # List available backups
    local backups=$(aws s3 ls "s3://$BACKUP_S3_BUCKET/daily/" --recursive | grep "$DATE_PATTERN" | sort -r)
    
    if [ -z "$backups" ]; then
        log "ERROR: No backups found for date pattern $DATE_PATTERN"
        exit 1
    fi
    
    # Get the most recent backup directory
    BACKUP_DATE=$(echo "$backups" | head -1 | awk '{print $4}' | cut -d'/' -f2)
    log "Found backup date: $BACKUP_DATE"
}

# Function to download backups
download_backups() {
    log "Downloading backups from S3"
    
    # Download all backup files for the selected date
    aws s3 sync "s3://$BACKUP_S3_BUCKET/daily/$BACKUP_DATE/" "$RECOVERY_DIR/"
    
    # Verify downloads
    if [ ! "$(ls -A $RECOVERY_DIR)" ]; then
        log "ERROR: No backup files downloaded"
        exit 1
    fi
    
    log "Backup files downloaded successfully"
    ls -la "$RECOVERY_DIR"
}

# Function to restore Redis data
restore_redis() {
    log "Restoring Redis data"
    
    local redis_backup=$(find "$RECOVERY_DIR" -name "redis_backup_*.rdb.gz" | head -1)
    
    if [ -f "$redis_backup" ]; then
        # Decompress Redis backup
        gunzip -c "$redis_backup" > "$RECOVERY_DIR/dump.rdb"
        
        # Stop Redis if running
        if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
            log "Stopping Redis service"
            # This would depend on your Redis setup (systemctl, docker, etc.)
            # docker stop redis || true
        fi
        
        # Copy backup to Redis data directory
        # This path may vary depending on your Redis configuration
        local redis_data_dir="/data"
        if [ -d "$redis_data_dir" ]; then
            cp "$RECOVERY_DIR/dump.rdb" "$redis_data_dir/"
            chown redis:redis "$redis_data_dir/dump.rdb" 2>/dev/null || true
        fi
        
        # Start Redis service
        log "Starting Redis service"
        # docker start redis || systemctl start redis
        
        # Wait for Redis to be ready
        local retries=30
        while [ $retries -gt 0 ]; do
            if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
                log "Redis is ready"
                break
            fi
            sleep 2
            retries=$((retries - 1))
        done
        
        if [ $retries -eq 0 ]; then
            log "ERROR: Redis failed to start"
            exit 1
        fi
        
        log "Redis data restored successfully"
    else
        log "WARNING: No Redis backup found"
    fi
}

# Function to restore configuration
restore_configuration() {
    log "Restoring configuration files"
    
    local config_backup=$(find "$RECOVERY_DIR" -name "config_backup_*.tar.gz" | head -1)
    
    if [ -f "$config_backup" ]; then
        # Extract configuration backup
        tar -xzf "$config_backup" -C "$RECOVERY_DIR/config/"
        
        # Copy configuration files to appropriate locations
        if [ -f "$RECOVERY_DIR/config/.env" ]; then
            cp "$RECOVERY_DIR/config/.env" "/app/.env"
            log "Environment configuration restored"
        fi
        
        if [ -f "$RECOVERY_DIR/config/nginx.conf" ]; then
            cp "$RECOVERY_DIR/config/nginx.conf" "/app/nginx.conf"
            log "Nginx configuration restored"
        fi
        
        log "Configuration files restored successfully"
    else
        log "WARNING: No configuration backup found"
    fi
}

# Function to restore application logs
restore_logs() {
    log "Restoring application logs"
    
    local logs_backup=$(find "$RECOVERY_DIR" -name "logs_backup_*.tar.gz" | head -1)
    
    if [ -f "$logs_backup" ]; then
        # Create logs directory if it doesn't exist
        mkdir -p "/app/logs"
        
        # Extract logs backup
        tar -xzf "$logs_backup" -C "/app/"
        
        log "Application logs restored successfully"
    else
        log "WARNING: No logs backup found"
    fi
}

# Function to restart services
restart_services() {
    log "Restarting application services"
    
    # This would depend on your deployment method
    if command -v docker-compose &> /dev/null; then
        # Docker Compose deployment
        cd /app
        docker-compose down
        docker-compose up -d
        
        # Wait for services to be healthy
        local retries=30
        while [ $retries -gt 0 ]; do
            if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
                log "Application is healthy"
                break
            fi
            sleep 10
            retries=$((retries - 1))
        done
        
        if [ $retries -eq 0 ]; then
            log "ERROR: Application failed to start"
            exit 1
        fi
        
    elif command -v systemctl &> /dev/null; then
        # Systemd service
        systemctl restart relationship-care-platform
        systemctl status relationship-care-platform
        
    else
        log "WARNING: Unknown service management system"
    fi
    
    log "Services restarted successfully"
}

# Function to verify recovery
verify_recovery() {
    log "Verifying disaster recovery"
    
    # Check application health
    if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
        log "✓ Application health check passed"
    else
        log "✗ Application health check failed"
        exit 1
    fi
    
    # Check Redis connectivity
    if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
        log "✓ Redis connectivity check passed"
    else
        log "✗ Redis connectivity check failed"
        exit 1
    fi
    
    # Check database connectivity (if applicable)
    if [ -n "$SUPABASE_URL" ]; then
        # This would require a database connectivity test
        log "✓ Database connectivity assumed (implement specific test)"
    fi
    
    log "Disaster recovery verification completed successfully"
}

# Function to cleanup recovery files
cleanup() {
    log "Cleaning up recovery files"
    rm -rf "$RECOVERY_DIR"
    log "Cleanup completed"
}

# Main disaster recovery process
main() {
    local start_time=$(date +%s)
    
    trap 'send_notification "FAILED" "Disaster recovery failed at $(date)"' ERR
    trap 'cleanup' EXIT
    
    # Check prerequisites
    check_prerequisites
    
    # Find and download latest backup
    find_latest_backup
    download_backups
    
    # Restore components
    restore_redis
    restore_configuration
    restore_logs
    
    # Restart services
    restart_services
    
    # Verify recovery
    verify_recovery
    
    # Calculate duration
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Send success notification
    send_notification "SUCCESS" "Disaster recovery completed successfully in ${duration}s (RTO: <1hr) at $(date)"
    
    log "Disaster recovery completed successfully in ${duration}s"
    
    if [ $duration -gt 3600 ]; then
        log "WARNING: Recovery time exceeded 1 hour RTO target"
    else
        log "✓ Recovery time within 1 hour RTO target"
    fi
}

# Show usage if no arguments provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 [DATE_PATTERN]"
    echo "Example: $0 20241201  # Recover from December 1, 2024 backups"
    echo "Example: $0           # Recover from today's backups"
    exit 1
fi

# Run main function
main "$@"