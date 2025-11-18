const GITHUB_URL_REGEX = /https?:\/\/github\.com\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)\/(?<type>commit|pull)\/(?<identifier>[A-Za-z0-9._-]+)/i;

const parseRateLimit = (headers) => {
  if (!headers) return null;
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  return {
    limit: limit ? Number(limit) : null,
    remaining: remaining ? Number(remaining) : null,
    reset: reset ? Number(reset) : null,
  };
};

const mergeRateLimit = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  return {
    limit: b.limit ?? a.limit,
    remaining:
      typeof b.remaining === 'number' && typeof a.remaining === 'number'
        ? Math.min(a.remaining, b.remaining)
        : b.remaining ?? a.remaining,
    reset: b.reset ?? a.reset,
  };
};

const fetchGitHubJson = async (endpoint) => {
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'CodeWorkflowVisualizer',
      Accept: 'application/vnd.github+json',
    },
  });

  const rateLimit = parseRateLimit(response.headers);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { message: text };
  }

  if (!response.ok) {
    const err = new Error(data?.message || 'GitHub request failed');
    err.status = response.status;
    err.rateLimit = rateLimit;
    throw err;
  }

  return { data, rateLimit };
};

export const parseGitHubUrl = (input) => {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(GITHUB_URL_REGEX);
  if (!match || !match.groups) return null;
  return {
    owner: match.groups.owner,
    repo: match.groups.repo.replace(/\.git$/, ''),
    type: match.groups.type === 'commit' ? 'commit' : 'pull',
    identifier: match.groups.identifier,
    url: trimmed,
  };
};

export const fetchGitHubPayload = async (inputUrl) => {
  const parsed = parseGitHubUrl(inputUrl);
  if (!parsed) {
    const err = new Error('Please provide a public GitHub commit or pull request URL.');
    err.status = 400;
    throw err;
  }

  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;

  if (parsed.type === 'commit') {
    const { data, rateLimit } = await fetchGitHubJson(`${base}/commits/${parsed.identifier}`);
    return {
      type: 'commit',
      repo: `${parsed.owner}/${parsed.repo}`,
      identifier: data.sha,
      title: data.commit?.message?.split('\n')[0] || 'Commit',
      url: data.html_url || parsed.url,
      author: {
        name: data.commit?.author?.name || data.author?.login || 'Unknown author',
        avatarUrl: data.author?.avatar_url || data.committer?.avatar_url || null,
        profileUrl: data.author?.html_url || null,
      },
      timestamp: data.commit?.author?.date || data.committer?.date || null,
      files: data.files || [],
      stats: {
        additions: data.stats?.additions ?? 0,
        deletions: data.stats?.deletions ?? 0,
        changedFiles: data.files?.length ?? 0,
      },
      rateLimit,
    };
  }

  const prEndpoint = `${base}/pulls/${parsed.identifier}`;
  const [prResponse, filesResponse] = await Promise.all([
    fetchGitHubJson(prEndpoint),
    fetchGitHubJson(`${prEndpoint}/files?per_page=100`),
  ]);

  const combinedRateLimit = mergeRateLimit(prResponse.rateLimit, filesResponse.rateLimit);

  return {
    type: 'pull',
    repo: `${parsed.owner}/${parsed.repo}`,
    identifier: `#${prResponse.data.number}`,
    title: prResponse.data.title || 'Pull Request',
    url: prResponse.data.html_url || parsed.url,
    author: {
      name: prResponse.data.user?.login || prResponse.data.head?.user?.login || 'Unknown author',
      avatarUrl: prResponse.data.user?.avatar_url || null,
      profileUrl: prResponse.data.user?.html_url || null,
    },
    timestamp: prResponse.data.updated_at || prResponse.data.created_at || null,
    files: filesResponse.data || [],
    stats: {
      additions: prResponse.data.additions ?? 0,
      deletions: prResponse.data.deletions ?? 0,
      changedFiles: prResponse.data.changed_files ?? filesResponse.data?.length ?? 0,
    },
    rateLimit: combinedRateLimit,
  };
};
