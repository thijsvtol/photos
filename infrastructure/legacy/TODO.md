# Infrastructure TODO and Future Improvements

## Technical Debt

### Code Duplication
- [ ] Extract common functions (command checks, color output, etc.) into `infrastructure/common.sh`
- [ ] Source common functions in all scripts to reduce duplication
- [ ] Standardize error handling across all scripts

### Enhanced R2 Cleanup
- [ ] Implement efficient bulk object deletion in `destroy.sh`
- [ ] Consider using S3-compatible API for large buckets
- [ ] Add progress indicator for object deletion

### Interactive vs Non-Interactive
- [x] Skip interactive prompts in CI/CD environments (deployed.sh now checks $CI env var)
- [ ] Add `--non-interactive` flag option for all scripts
- [ ] Improve detection of terminal availability

## Feature Enhancements

### Multi-Environment Support
- [ ] Add environment-specific configs (dev, staging, prod)
- [ ] Support environment switching in scripts
- [ ] Document multi-environment workflows

### Testing
- [ ] Add automated tests for shell scripts (using bats or similar)
- [ ] Test infrastructure provisioning in isolated environment
- [ ] Add smoke tests after deployment

### Monitoring & Alerting
- [ ] Add cost tracking and reporting
- [ ] Implement drift detection
- [ ] Add Slack/Discord notifications for deployments
- [ ] Performance monitoring integration

### Advanced Features
- [ ] Terraform/Pulumi provider as alternative approach
- [ ] Automated backup scheduling
- [ ] Blue-green deployment support
- [ ] Rollback automation
- [ ] Infrastructure versioning

### Documentation
- [ ] Add video walkthrough of deployment process
- [ ] Create troubleshooting decision tree
- [ ] Add more architecture diagrams
- [ ] Document common failure scenarios and recovery

## Operational Improvements

### Security
- [ ] Implement infrastructure scanning (e.g., tfsec equivalent)
- [ ] Add secret rotation automation
- [ ] Audit logging for all infrastructure changes
- [ ] Implement least-privilege access policies

### CI/CD
- [ ] Add deployment preview environments
- [ ] Implement automated rollback on failure
- [ ] Add deployment approval gates
- [ ] Integration tests in pipeline

### Developer Experience
- [ ] Add shell completion for custom scripts
- [ ] Create VS Code tasks for common operations
- [ ] Add pre-commit hooks for validation
- [ ] Interactive configuration wizard

## Nice to Have

- [ ] Web dashboard for infrastructure status
- [ ] CLI tool (instead of separate scripts)
- [ ] Resource dependency graph visualization
- [ ] Cost optimization recommendations
- [ ] Automatic documentation generation
- [ ] Infrastructure diff tool (preview changes before apply)

## Notes

- Items marked with [x] are completed
- Items marked with [ ] are open for future implementation
- Priority should be based on actual usage patterns and pain points

## Contributing

When addressing items from this list:
1. Create a new branch
2. Implement the feature/fix
3. Update this TODO list
4. Submit PR with tests and documentation
5. Mark item as complete with [x]
