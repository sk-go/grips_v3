# Deployment and Monitoring Setup

This directory contains all the necessary configuration files and scripts for deploying and monitoring the Relationship Care Platform in production.

## Overview

The deployment setup includes:
- **CI/CD Pipeline**: GitHub Actions for automated testing and deployment
- **Infrastructure as Code**: Terraform configurations for AWS resources
- **Containerization**: Docker configuration for consistent deployments
- **Blue-Green Deployment**: Zero-downtime deployment strategy
- **Backup & Recovery**: Automated backup and disaster recovery procedures
- **Monitoring**: Comprehensive uptime and performance monitoring

## Prerequisites

### Required Tools
- Docker and Docker Compose
- AWS CLI v2
- Terraform >= 1.0
- Node.js 18+
- jq (for JSON parsing)
- curl (for health checks)

### AWS Services Used
- **ECS Fargate**: Container orchestration
- **Application Load Balancer**: Traffic distribution and SSL termination
- **ElastiCache Redis**: Session management and caching
- **S3**: File storage and backups
- **CloudWatch**: Logging and monitoring
- **SNS**: Alert notifications
- **Route 53**: Health checks and DNS
- **ACM**: SSL certificate management

## Quick Start

### 1. Infrastructure Setup

```bash
# Navigate to infrastructure directory
cd infrastructure

# Initialize Terraform
terraform init

# Review and customize variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Plan deployment
terraform plan

# Deploy infrastructure
terraform apply
```

### 2. Configure Secrets

Set up the following secrets in AWS Systems Manager Parameter Store:
- `/{app_name}/supabase_url`
- `/{app_name}/supabase_service_role_key`
- `/{app_name}/jwt_secret`
- `/{app_name}/grok_api_key`
- `/{app_name}/twilio_account_sid`
- `/{app_name}/twilio_auth_token`

### 3. GitHub Actions Setup

Configure the following secrets in your GitHub repository:
- `SUPABASE_TEST_URL`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

### 4. Deploy Application

```bash
# Build and push Docker image
docker build -t ghcr.io/your-org/relationship-care-platform:latest .
docker push ghcr.io/your-org/relationship-care-platform:latest

# Deploy using blue-green strategy
./scripts/blue-green-deploy.sh ghcr.io/your-org/relationship-care-platform:latest
```

## Configuration Files

### GitHub Actions (`.github/workflows/ci-cd.yml`)
- Automated testing on pull requests
- Security scanning with Trivy
- Docker image building and pushing
- Blue-green deployment to production

### Terraform Infrastructure (`infrastructure/`)
- **main.tf**: Core infrastructure (VPC, ECS, ALB)
- **iam.tf**: IAM roles and policies
- **storage.tf**: S3 buckets and ElastiCache Redis
- **monitoring.tf**: CloudWatch alarms and dashboards
- **secrets.tf**: SSM parameters for secrets
- **outputs.tf**: Infrastructure outputs

### Docker Configuration
- **Dockerfile**: Multi-stage build for production optimization
- **docker-compose.prod.yml**: Production deployment configuration
- **nginx.conf**: Load balancer and SSL configuration

## Scripts

### Backup Script (`scripts/backup.sh`)
Automated daily backups including:
- Redis cache data
- Application logs
- Configuration files
- Upload to S3 with lifecycle management

Usage:
```bash
./scripts/backup.sh
```

### Disaster Recovery (`scripts/disaster-recovery.sh`)
Automated disaster recovery with <1hr RTO:
- Download latest backups from S3
- Restore Redis data
- Restore configuration files
- Restart services
- Verify system health

Usage:
```bash
./scripts/disaster-recovery.sh [DATE_PATTERN]
```

### Blue-Green Deployment (`scripts/blue-green-deploy.sh`)
Zero-downtime deployment strategy:
- Create new "green" service
- Health check new deployment
- Switch traffic from "blue" to "green"
- Cleanup old deployment

Usage:
```bash
./scripts/blue-green-deploy.sh <IMAGE_URI>
```

### Uptime Monitoring (`scripts/uptime-monitor.sh`)
Continuous monitoring for >99.9% uptime:
- Application health checks
- Redis connectivity
- Database connectivity
- System resource monitoring
- SSL certificate expiration
- Automated alerting

Usage:
```bash
# Continuous monitoring
./scripts/uptime-monitor.sh monitor

# Single health check
./scripts/uptime-monitor.sh check

# Show current status
./scripts/uptime-monitor.sh status

# Generate report
./scripts/uptime-monitor.sh report
```

## Monitoring and Alerting

### CloudWatch Dashboards
- ECS service metrics (CPU, memory, task count)
- Load balancer metrics (requests, response time, errors)
- Custom application metrics

### Alerts Configuration
Alerts are sent via SNS for:
- High CPU utilization (>80%)
- High memory utilization (>85%)
- High response time (>2s)
- 5XX error rate increase
- Health check failures
- SSL certificate expiration

### Uptime Monitoring
- Target: >99.9% uptime
- Health checks every 30 seconds
- Automated failover and recovery
- Daily uptime reports

## Security

### Network Security
- VPC with public/private subnets
- Security groups with minimal required access
- NAT Gateway for outbound internet access
- Application Load Balancer with SSL termination

### Data Security
- Encryption at rest (S3, ElastiCache)
- Encryption in transit (TLS 1.3)
- Secrets management via AWS Systems Manager
- Regular security scanning in CI/CD

### Access Control
- IAM roles with least privilege
- Service-to-service authentication
- Container security scanning
- Regular security updates

## Performance Targets

### Response Times
- API responses: <500ms (including CRM calls)
- UI interactions: <200ms
- Voice processing: <1.5s end-to-end

### Scalability
- Auto-scaling based on CPU/memory utilization
- Support for 100+ concurrent users
- Horizontal scaling of ECS tasks
- Redis clustering for high availability

### Availability
- Target: >99.9% uptime
- Blue-green deployments for zero downtime
- Multi-AZ deployment for high availability
- Automated failover and recovery

## Troubleshooting

### Common Issues

1. **Deployment Failures**
   - Check ECS service logs in CloudWatch
   - Verify task definition configuration
   - Check security group rules

2. **Health Check Failures**
   - Verify application is listening on correct port
   - Check load balancer target group health
   - Review application logs

3. **High Response Times**
   - Check ECS service CPU/memory utilization
   - Review database connection pool settings
   - Analyze CloudWatch performance metrics

4. **SSL Certificate Issues**
   - Verify ACM certificate validation
   - Check Route 53 DNS configuration
   - Review load balancer listener configuration

### Log Locations
- Application logs: CloudWatch Log Group `/aws/ecs/{app_name}`
- ECS service events: ECS console
- Load balancer logs: S3 bucket (if enabled)
- Infrastructure logs: CloudTrail

### Support Contacts
- Infrastructure issues: DevOps team
- Application issues: Development team
- Security issues: Security team

## Maintenance

### Regular Tasks
- Review and rotate secrets quarterly
- Update base Docker images monthly
- Review and update security groups
- Monitor and optimize costs
- Update Terraform configurations

### Backup Verification
- Test disaster recovery procedures monthly
- Verify backup integrity weekly
- Review backup retention policies quarterly

### Performance Optimization
- Review CloudWatch metrics weekly
- Optimize database queries based on performance data
- Update auto-scaling policies based on usage patterns
- Review and optimize container resource allocation

## Cost Optimization

### Resource Management
- Use Spot instances for non-critical workloads
- Implement auto-scaling to match demand
- Regular review of unused resources
- S3 lifecycle policies for backup retention

### Monitoring Costs
- Set up billing alerts
- Regular cost analysis and optimization
- Review resource utilization metrics
- Optimize container resource allocation

## Compliance

### Data Protection
- GDPR compliance for EU users
- HIPAA compliance for healthcare data
- Regular security audits
- Data retention policies

### Audit Requirements
- All actions logged in CloudTrail
- Application audit logs in database
- Regular compliance assessments
- Documentation maintenance

---

For additional support or questions, please refer to the project documentation or contact the development team.