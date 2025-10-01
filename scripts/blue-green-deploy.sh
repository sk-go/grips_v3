#!/bin/bash

# Blue-Green Deployment script for Relationship Care Platform
# This script implements zero-downtime deployment using blue-green strategy

set -e

# Configuration
APP_NAME="${APP_NAME:-relationship-care-platform}"
CLUSTER_NAME="${CLUSTER_NAME:-$APP_NAME-cluster}"
SERVICE_NAME="${SERVICE_NAME:-$APP_NAME-service}"
TASK_FAMILY="${TASK_FAMILY:-$APP_NAME-task}"
IMAGE_URI="${1:-ghcr.io/$APP_NAME:latest}"
AWS_REGION="${AWS_REGION:-us-east-1}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-/api/health}"
DEPLOYMENT_TIMEOUT=600  # 10 minutes

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to log messages with colors
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        "INFO")
            echo -e "${BLUE}[INFO]${NC} [$timestamp] $message"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[SUCCESS]${NC} [$timestamp] $message"
            ;;
        "WARNING")
            echo -e "${YELLOW}[WARNING]${NC} [$timestamp] $message"
            ;;
        "ERROR")
            echo -e "${RED}[ERROR]${NC} [$timestamp] $message"
            ;;
    esac
}

# Function to send notification
send_notification() {
    local status=$1
    local message=$2
    
    if [ -n "$SNS_TOPIC_ARN" ]; then
        aws sns publish \
            --topic-arn "$SNS_TOPIC_ARN" \
            --subject "Deployment $status - $APP_NAME" \
            --message "$message" \
            --region "$AWS_REGION" > /dev/null 2>&1 || true
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log "INFO" "Checking prerequisites"
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log "ERROR" "AWS CLI not found"
        exit 1
    fi
    
    # Check jq
    if ! command -v jq &> /dev/null; then
        log "ERROR" "jq not found (required for JSON parsing)"
        exit 1
    fi
    
    # Verify AWS credentials
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        log "ERROR" "AWS credentials not configured"
        exit 1
    fi
    
    # Check if ECS cluster exists
    if ! aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
        log "ERROR" "ECS cluster '$CLUSTER_NAME' not found"
        exit 1
    fi
    
    log "SUCCESS" "Prerequisites check passed"
}

# Function to get current service configuration
get_current_service() {
    log "INFO" "Getting current service configuration"
    
    CURRENT_SERVICE=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$AWS_REGION" \
        --query 'services[0]' 2>/dev/null || echo "null")
    
    if [ "$CURRENT_SERVICE" = "null" ]; then
        log "ERROR" "Service '$SERVICE_NAME' not found in cluster '$CLUSTER_NAME'"
        exit 1
    fi
    
    CURRENT_TASK_DEFINITION=$(echo "$CURRENT_SERVICE" | jq -r '.taskDefinition')
    CURRENT_DESIRED_COUNT=$(echo "$CURRENT_SERVICE" | jq -r '.desiredCount')
    
    log "INFO" "Current task definition: $CURRENT_TASK_DEFINITION"
    log "INFO" "Current desired count: $CURRENT_DESIRED_COUNT"
}

# Function to create new task definition
create_new_task_definition() {
    log "INFO" "Creating new task definition with image: $IMAGE_URI"
    
    # Get current task definition
    CURRENT_TASK_DEF=$(aws ecs describe-task-definition \
        --task-definition "$CURRENT_TASK_DEFINITION" \
        --region "$AWS_REGION" \
        --query 'taskDefinition')
    
    # Update image URI in task definition
    NEW_TASK_DEF=$(echo "$CURRENT_TASK_DEF" | jq --arg image "$IMAGE_URI" '
        .containerDefinitions[0].image = $image |
        del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .placementConstraints, .compatibilities, .registeredAt, .registeredBy)
    ')
    
    # Register new task definition
    NEW_TASK_DEFINITION_ARN=$(aws ecs register-task-definition \
        --region "$AWS_REGION" \
        --cli-input-json "$NEW_TASK_DEF" \
        --query 'taskDefinition.taskDefinitionArn' \
        --output text)
    
    log "SUCCESS" "New task definition created: $NEW_TASK_DEFINITION_ARN"
}

# Function to create blue-green service
create_green_service() {
    log "INFO" "Creating green service for blue-green deployment"
    
    GREEN_SERVICE_NAME="${SERVICE_NAME}-green"
    
    # Check if green service already exists
    EXISTING_GREEN=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION" \
        --query 'services[0].status' \
        --output text 2>/dev/null || echo "MISSING")
    
    if [ "$EXISTING_GREEN" != "MISSING" ] && [ "$EXISTING_GREEN" != "INACTIVE" ]; then
        log "INFO" "Deleting existing green service"
        aws ecs update-service \
            --cluster "$CLUSTER_NAME" \
            --service "$GREEN_SERVICE_NAME" \
            --desired-count 0 \
            --region "$AWS_REGION" > /dev/null
        
        aws ecs wait services-stable \
            --cluster "$CLUSTER_NAME" \
            --services "$GREEN_SERVICE_NAME" \
            --region "$AWS_REGION"
        
        aws ecs delete-service \
            --cluster "$CLUSTER_NAME" \
            --service "$GREEN_SERVICE_NAME" \
            --region "$AWS_REGION" > /dev/null
    fi
    
    # Get current service configuration
    CURRENT_SERVICE_CONFIG=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$AWS_REGION" \
        --query 'services[0]')
    
    # Extract load balancer configuration
    LOAD_BALANCERS=$(echo "$CURRENT_SERVICE_CONFIG" | jq '.loadBalancers')
    NETWORK_CONFIG=$(echo "$CURRENT_SERVICE_CONFIG" | jq '.networkConfiguration')
    
    # Create green service
    aws ecs create-service \
        --cluster "$CLUSTER_NAME" \
        --service-name "$GREEN_SERVICE_NAME" \
        --task-definition "$NEW_TASK_DEFINITION_ARN" \
        --desired-count "$CURRENT_DESIRED_COUNT" \
        --launch-type "FARGATE" \
        --network-configuration "$NETWORK_CONFIG" \
        --region "$AWS_REGION" > /dev/null
    
    log "SUCCESS" "Green service created: $GREEN_SERVICE_NAME"
}

# Function to wait for green service to be healthy
wait_for_green_service() {
    log "INFO" "Waiting for green service to be healthy"
    
    GREEN_SERVICE_NAME="${SERVICE_NAME}-green"
    
    # Wait for service to be stable
    log "INFO" "Waiting for green service to be stable..."
    aws ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION"
    
    # Get green service tasks
    GREEN_TASKS=$(aws ecs list-tasks \
        --cluster "$CLUSTER_NAME" \
        --service-name "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION" \
        --query 'taskArns' \
        --output text)
    
    if [ -z "$GREEN_TASKS" ]; then
        log "ERROR" "No tasks found for green service"
        exit 1
    fi
    
    # Wait for tasks to be running
    log "INFO" "Waiting for green service tasks to be running..."
    aws ecs wait tasks-running \
        --cluster "$CLUSTER_NAME" \
        --tasks $GREEN_TASKS \
        --region "$AWS_REGION"
    
    log "SUCCESS" "Green service is healthy and running"
}

# Function to perform health checks on green service
health_check_green_service() {
    log "INFO" "Performing health checks on green service"
    
    GREEN_SERVICE_NAME="${SERVICE_NAME}-green"
    
    # Get task IPs for health checking
    GREEN_TASKS=$(aws ecs list-tasks \
        --cluster "$CLUSTER_NAME" \
        --service-name "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION" \
        --query 'taskArns' \
        --output text)
    
    # For each task, perform health check
    for task_arn in $GREEN_TASKS; do
        # Get task details
        TASK_DETAIL=$(aws ecs describe-tasks \
            --cluster "$CLUSTER_NAME" \
            --tasks "$task_arn" \
            --region "$AWS_REGION" \
            --query 'tasks[0]')
        
        # Extract private IP (this would work in a VPC setup)
        PRIVATE_IP=$(echo "$TASK_DETAIL" | jq -r '.attachments[0].details[] | select(.name=="privateIPv4Address") | .value')
        
        if [ "$PRIVATE_IP" != "null" ] && [ -n "$PRIVATE_IP" ]; then
            log "INFO" "Health checking task at IP: $PRIVATE_IP"
            
            # Perform health check with retries
            local retries=10
            local health_check_passed=false
            
            while [ $retries -gt 0 ]; do
                if curl -f -s "http://$PRIVATE_IP:3000$HEALTH_CHECK_URL" > /dev/null 2>&1; then
                    log "SUCCESS" "Health check passed for task at $PRIVATE_IP"
                    health_check_passed=true
                    break
                fi
                
                log "INFO" "Health check failed, retrying... ($retries attempts left)"
                sleep 10
                retries=$((retries - 1))
            done
            
            if [ "$health_check_passed" = false ]; then
                log "ERROR" "Health check failed for task at $PRIVATE_IP"
                return 1
            fi
        fi
    done
    
    log "SUCCESS" "All health checks passed for green service"
}

# Function to switch traffic to green service
switch_traffic_to_green() {
    log "INFO" "Switching traffic from blue to green service"
    
    GREEN_SERVICE_NAME="${SERVICE_NAME}-green"
    
    # Get current load balancer target group
    CURRENT_SERVICE_CONFIG=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$AWS_REGION" \
        --query 'services[0]')
    
    LOAD_BALANCERS=$(echo "$CURRENT_SERVICE_CONFIG" | jq '.loadBalancers')
    
    # Update green service with load balancer configuration
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$GREEN_SERVICE_NAME" \
        --load-balancers "$LOAD_BALANCERS" \
        --region "$AWS_REGION" > /dev/null
    
    # Wait for green service to be stable with load balancer
    log "INFO" "Waiting for green service to be stable with load balancer..."
    aws ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION"
    
    # Remove load balancer from blue service
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$SERVICE_NAME" \
        --load-balancers '[]' \
        --region "$AWS_REGION" > /dev/null
    
    log "SUCCESS" "Traffic switched to green service"
}

# Function to verify deployment
verify_deployment() {
    log "INFO" "Verifying deployment through load balancer"
    
    # Get load balancer DNS name
    LB_DNS=$(aws elbv2 describe-load-balancers \
        --region "$AWS_REGION" \
        --query "LoadBalancers[?contains(LoadBalancerName, '$APP_NAME')].DNSName" \
        --output text)
    
    if [ -n "$LB_DNS" ]; then
        local retries=10
        local verification_passed=false
        
        while [ $retries -gt 0 ]; do
            if curl -f -s "https://$LB_DNS$HEALTH_CHECK_URL" > /dev/null 2>&1; then
                log "SUCCESS" "Deployment verification passed through load balancer"
                verification_passed=true
                break
            fi
            
            log "INFO" "Verification failed, retrying... ($retries attempts left)"
            sleep 15
            retries=$((retries - 1))
        done
        
        if [ "$verification_passed" = false ]; then
            log "ERROR" "Deployment verification failed"
            return 1
        fi
    else
        log "WARNING" "Could not find load balancer DNS for verification"
    fi
}

# Function to cleanup old blue service
cleanup_blue_service() {
    log "INFO" "Cleaning up old blue service"
    
    # Scale down blue service
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$SERVICE_NAME" \
        --desired-count 0 \
        --region "$AWS_REGION" > /dev/null
    
    # Wait for blue service to scale down
    aws ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$AWS_REGION"
    
    # Delete blue service
    aws ecs delete-service \
        --cluster "$CLUSTER_NAME" \
        --service "$SERVICE_NAME" \
        --region "$AWS_REGION" > /dev/null
    
    log "SUCCESS" "Old blue service cleaned up"
}

# Function to promote green to blue
promote_green_to_blue() {
    log "INFO" "Promoting green service to blue"
    
    GREEN_SERVICE_NAME="${SERVICE_NAME}-green"
    
    # Get green service configuration
    GREEN_SERVICE_CONFIG=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION" \
        --query 'services[0]')
    
    LOAD_BALANCERS=$(echo "$GREEN_SERVICE_CONFIG" | jq '.loadBalancers')
    NETWORK_CONFIG=$(echo "$GREEN_SERVICE_CONFIG" | jq '.networkConfiguration')
    
    # Create new blue service (original service name)
    aws ecs create-service \
        --cluster "$CLUSTER_NAME" \
        --service-name "$SERVICE_NAME" \
        --task-definition "$NEW_TASK_DEFINITION_ARN" \
        --desired-count "$CURRENT_DESIRED_COUNT" \
        --launch-type "FARGATE" \
        --load-balancers "$LOAD_BALANCERS" \
        --network-configuration "$NETWORK_CONFIG" \
        --region "$AWS_REGION" > /dev/null
    
    # Wait for new blue service to be stable
    aws ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" \
        --region "$AWS_REGION"
    
    # Delete green service
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$GREEN_SERVICE_NAME" \
        --desired-count 0 \
        --region "$AWS_REGION" > /dev/null
    
    aws ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION"
    
    aws ecs delete-service \
        --cluster "$CLUSTER_NAME" \
        --service "$GREEN_SERVICE_NAME" \
        --region "$AWS_REGION" > /dev/null
    
    log "SUCCESS" "Green service promoted to blue"
}

# Function to rollback deployment
rollback_deployment() {
    log "WARNING" "Rolling back deployment"
    
    GREEN_SERVICE_NAME="${SERVICE_NAME}-green"
    
    # Check if green service exists
    if aws ecs describe-services --cluster "$CLUSTER_NAME" --services "$GREEN_SERVICE_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
        # Scale down and delete green service
        aws ecs update-service \
            --cluster "$CLUSTER_NAME" \
            --service "$GREEN_SERVICE_NAME" \
            --desired-count 0 \
            --region "$AWS_REGION" > /dev/null
        
        aws ecs wait services-stable \
            --cluster "$CLUSTER_NAME" \
            --services "$GREEN_SERVICE_NAME" \
            --region "$AWS_REGION"
        
        aws ecs delete-service \
            --cluster "$CLUSTER_NAME" \
            --service "$GREEN_SERVICE_NAME" \
            --region "$AWS_REGION" > /dev/null
    fi
    
    log "SUCCESS" "Rollback completed - blue service remains active"
}

# Main deployment function
main() {
    local start_time=$(date +%s)
    
    log "INFO" "Starting blue-green deployment for $APP_NAME"
    log "INFO" "Image: $IMAGE_URI"
    
    # Set up error handling
    trap 'log "ERROR" "Deployment failed, initiating rollback"; rollback_deployment; send_notification "FAILED" "Blue-green deployment failed and rolled back at $(date)"; exit 1' ERR
    
    # Check prerequisites
    check_prerequisites
    
    # Get current service state
    get_current_service
    
    # Create new task definition
    create_new_task_definition
    
    # Create green service
    create_green_service
    
    # Wait for green service to be healthy
    wait_for_green_service
    
    # Perform health checks
    if ! health_check_green_service; then
        log "ERROR" "Health checks failed for green service"
        exit 1
    fi
    
    # Switch traffic to green
    switch_traffic_to_green
    
    # Verify deployment
    if ! verify_deployment; then
        log "ERROR" "Deployment verification failed"
        exit 1
    fi
    
    # Cleanup old blue service
    cleanup_blue_service
    
    # Promote green to blue
    promote_green_to_blue
    
    # Calculate deployment time
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Send success notification
    send_notification "SUCCESS" "Blue-green deployment completed successfully in ${duration}s at $(date)"
    
    log "SUCCESS" "Blue-green deployment completed successfully in ${duration}s"
    log "SUCCESS" "New image deployed: $IMAGE_URI"
}

# Show usage if no image URI provided
if [ -z "$1" ]; then
    echo "Usage: $0 <IMAGE_URI>"
    echo "Example: $0 ghcr.io/relationship-care-platform:v1.2.3"
    exit 1
fi

# Run main function
main "$@"