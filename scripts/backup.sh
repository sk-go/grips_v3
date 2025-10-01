#!/bin/bash

# Backup script for Relationship Care Platform
# This script creates daily backups of Redis cache data and application logs

set -e

# Configuration
BACKUP_DIR="/tmp/backups"
DATE=$(date +%Y%m%d_%H%M%S)
S3_BUCKET="${S3_BACKUP_BUCKET:-relationship-care-platform-backups}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
RETENTION_DAYS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Starting backup process at $(date)"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to cleanup old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days"
    find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete
    
    # Cleanup S3 backups (handled by lifecycle policy, but can be done manually)
    if command -v aws &> /dev/null; then
        aws s3 ls "s3://$S3_BUCKET/" --recursive | \
        awk '$1 <= "'$(date -d "$RETENTION_DAYS days ago" '+%Y-%m-%d')'" {print $4}' | \
        xargs -I {} aws s3 rm "s3://$S3_BUCKET/{}"
    fi
}

# Function to backup Redis data
backup_redis() {
    log "Starting Redis backup"
    
    if command -v redis-cli &> /dev/null; then
        # Create Redis backup
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --rdb "$BACKUP_DIR/redis_backup_$DATE.rdb"
        
        # Compress the backup
        gzip "$BACKUP_DIR/redis_backup_$DATE.rdb"
        
        log "Redis backup completed: redis_backup_$DATE.rdb.gz"
    else
        log "WARNING: redis-cli not found, skipping Redis backup"
    fi
}

# Function to backup application logs
backup_logs() {
    log "Starting logs backup"
    
    if [ -d "/app/logs" ]; then
        tar -czf "$BACKUP_DIR/logs_backup_$DATE.tar.gz" -C /app logs/
        log "Logs backup completed: logs_backup_$DATE.tar.gz"
    else
        log "WARNING: /app/logs directory not found, skipping logs backup"
    fi
}

# Function to backup configuration files
backup_config() {
    log "Starting configuration backup"
    
    CONFIG_FILES=(
        "/app/.env"
        "/app/package.json"
        "/app/docker-compose.yml"
        "/app/nginx.conf"
    )
    
    for file in "${CONFIG_FILES[@]}"; do
        if [ -f "$file" ]; then
            cp "$file" "$BACKUP_DIR/"
        fi
    done
    
    if [ "$(ls -A $BACKUP_DIR/*.json $BACKUP_DIR/*.yml $BACKUP_DIR/.env 2>/dev/null)" ]; then
        tar -czf "$BACKUP_DIR/config_backup_$DATE.tar.gz" -C "$BACKUP_DIR" \
            --exclude="*.tar.gz" --exclude="*.rdb*" .
        
        # Remove individual config files after archiving
        rm -f "$BACKUP_DIR"/*.json "$BACKUP_DIR"/*.yml "$BACKUP_DIR"/.env
        
        log "Configuration backup completed: config_backup_$DATE.tar.gz"
    fi
}

# Function to upload backups to S3
upload_to_s3() {
    log "Uploading backups to S3"
    
    if command -v aws &> /dev/null; then
        for backup_file in "$BACKUP_DIR"/*.tar.gz "$BACKUP_DIR"/*.rdb.gz; do
            if [ -f "$backup_file" ]; then
                filename=$(basename "$backup_file")
                aws s3 cp "$backup_file" "s3://$S3_BUCKET/daily/$DATE/$filename"
                log "Uploaded $filename to S3"
            fi
        done
    else
        log "WARNING: AWS CLI not found, skipping S3 upload"
    fi
}

# Function to verify backup integrity
verify_backups() {
    log "Verifying backup integrity"
    
    for backup_file in "$BACKUP_DIR"/*.tar.gz; do
        if [ -f "$backup_file" ]; then
            if tar -tzf "$backup_file" > /dev/null 2>&1; then
                log "✓ $backup_file is valid"
            else
                log "✗ $backup_file is corrupted"
                exit 1
            fi
        fi
    done
    
    for backup_file in "$BACKUP_DIR"/*.rdb.gz; do
        if [ -f "$backup_file" ]; then
            if gzip -t "$backup_file" > /dev/null 2>&1; then
                log "✓ $backup_file is valid"
            else
                log "✗ $backup_file is corrupted"
                exit 1
            fi
        fi
    done
}

# Function to send notification
send_notification() {
    local status=$1
    local message=$2
    
    if [ -n "$SNS_TOPIC_ARN" ] && command -v aws &> /dev/null; then
        aws sns publish \
            --topic-arn "$SNS_TOPIC_ARN" \
            --subject "Backup $status - Relationship Care Platform" \
            --message "$message"
    fi
    
    log "$message"
}

# Main backup process
main() {
    local start_time=$(date +%s)
    
    trap 'send_notification "FAILED" "Backup process failed at $(date)"' ERR
    
    # Perform backups
    backup_redis
    backup_logs
    backup_config
    
    # Verify backups
    verify_backups
    
    # Upload to S3
    upload_to_s3
    
    # Cleanup old backups
    cleanup_old_backups
    
    # Calculate duration
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Send success notification
    send_notification "SUCCESS" "Backup completed successfully in ${duration}s at $(date)"
    
    log "Backup process completed successfully in ${duration}s"
}

# Run main function
main "$@"