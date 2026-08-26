export interface EnvironmentIssue {
  name: string;
  reason: string;
}
/**
 * Configuration errors intentionally contain variable names, never their values.
 * This makes the error safe to pass to the structured logger.
 */
export class EnvironmentConfigurationError extends Error {
  readonly code = "ENVIRONMENT_CONFIGURATION_ERROR";
  readonly issues: readonly EnvironmentIssue[];

  constructor(issues: readonly EnvironmentIssue[]) {
    const uniqueIssues = Array.from(
      new Map(issues.map((issue) => [`${issue.name}:${issue.reason}`, issue])).values(),
    );
    super(
      `Environment configuration is invalid: ${uniqueIssues
        .map((issue) => `${issue.name} ${issue.reason}`)
        .join(", ")}.`,
    );
    this.name = "EnvironmentConfigurationError";
    this.issues = uniqueIssues;
  }
}
