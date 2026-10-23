// The provider-neutral contract (docs/04). GitHub implements it today; GitLab must fit behind the same names.

export type InstallationInfo = {
  id: number;
  accountLogin: string;
  accountType: "Organization" | "User";
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
  events: string[];
  suspended: boolean;
};

export type RepoInfo = { id: number; fullName: string; private: boolean };

export type DeliverySummary = { event: string; action: string | null; statusCode: number; deliveredAt: string };

export interface SourceControl {
  readonly provider: "github";
  /** The installation, or null when it does not exist (or does not belong to this App). */
  getInstallation(installationId: number): Promise<InstallationInfo | null>;
  /** Every installation of the App (diagnostics only). */
  listInstallations(): Promise<InstallationInfo[]>;
  /** Repositories the installation can reach. Short-lived tokens are created inside and never leave this object. */
  listRepositories(installationId: number): Promise<RepoInfo[]>;
  /** Issue type names of the organisation, or null when the App may not read them. */
  listIssueTypes(installationId: number, organisation: string): Promise<string[] | null>;
  /** The newest webhook deliveries the App received, newest first. */
  listRecentDeliveries(): Promise<DeliverySummary[]>;
}
