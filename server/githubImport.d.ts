export interface GitHubProxyFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blob_url?: string;
  raw_url?: string;
}

export interface GitHubProxyRateLimit {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export interface GitHubProxyPayload {
  type: 'commit' | 'pull';
  repo: string;
  identifier: string;
  title: string;
  url: string;
  author: {
    name: string;
    avatarUrl: string | null;
    profileUrl: string | null;
  };
  timestamp: string | null;
  stats: {
    additions: number;
    deletions: number;
    changedFiles: number;
  };
  files: GitHubProxyFile[];
  rateLimit: GitHubProxyRateLimit | null;
}

export declare function fetchGitHubPayload(url: string): Promise<GitHubProxyPayload>;
export declare function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
  type: 'commit' | 'pull';
  identifier: string;
  url: string;
} | null;
