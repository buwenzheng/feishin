/**
 * GitHub 仓库：用于 electron-updater（与 alpha 对比时的 latest 源）、发行说明 API、更新提示里的链接。
 * 请与 `electron-builder.yml` 中 `publish.owner` / `publish.repo` 保持一致，否则自动更新与 UI 会指向不同仓库。
 */
export const GITHUB_RELEASE_OWNER = 'buwenzheng';
export const GITHUB_RELEASE_REPO = 'feishin';

export const GITHUB_RELEASE_WEB_BASE = `https://github.com/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}`;
export const GITHUB_RELEASE_API_BASE = `https://api.github.com/repos/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}`;

export const GITHUB_RELEASES_API_URL = `${GITHUB_RELEASE_API_BASE}/releases`;
export const GITHUB_COMPARE_API_URL = `${GITHUB_RELEASE_API_BASE}/compare`;

export const githubReleaseTagUrl = (tag: string) =>
    `${GITHUB_RELEASE_WEB_BASE}/releases/tag/${tag.startsWith('v') ? tag : `v${tag}`}`;

export const githubCompareWebUrl = (base: string, head: string) =>
    `${GITHUB_RELEASE_WEB_BASE}/compare/${base}...${head}`;
