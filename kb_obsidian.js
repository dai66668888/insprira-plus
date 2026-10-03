// 灵感熔炉 · Obsidian Vault 读写模块
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseFrontmatter(content) {
  const frontmatter = {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };

  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, raw] = kv;
    raw = raw.trim();

    // tags: [tag1, tag2] or tags:\n  - tag1\n  - tag2
    if (key === 'tags') {
      if (raw.startsWith('[')) {
        const inner = raw.slice(1, raw.indexOf(']')).trim();
        frontmatter[key] = inner ? inner.split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
      } else {
        const tags = [];
        while (index + 1 < lines.length) {
          const item = lines[index + 1].match(/^\s*-\s*(.+)$/);
          if (!item) break;
          tags.push(item[1].trim().replace(/^['"]|['"]$/g, ''));
          index++;
        }
        frontmatter[key] = tags.filter(Boolean);
      }
      continue;
    }

    //去除首尾引号
    frontmatter[key] = raw.replace(/^['"]|['"]$/g, '');
  }

  return { frontmatter, body: content.slice(match[0].length) };
}

function resolveVaultPath(vaultPath) {
  const resolved = path.resolve(vaultPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Vault 路径无效');
  }
  return fs.realpathSync(resolved);
}

function resolveInsideVault(vaultPath, relativePath, allowRoot = false) {
  const root = resolveVaultPath(vaultPath);
  const target = path.resolve(root, String(relativePath || '').replace(/^[/\\]+/, ''));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('路径越界');
  if (!allowRoot && target === root) throw new Error('路径越界');
  return { root, target };
}

function formatFrontmatter(title, tags, date) {
  const lines = ['---'];
  lines.push(`title: "${title.replace(/"/g, '\\"')}"`);
  if (tags && tags.length) {
    lines.push(`tags: [${tags.map(t => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`);
  }
  lines.push(`created: ${date || new Date().toISOString().split('T')[0]}`);
  lines.push('---', '');
  return lines.join('\n');
}

function walkVault(dir, vaultPath) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.obsidian' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkVault(fullPath, vaultPath));
    } else if (entry.name.endsWith('.md')) {
      const relPath = path.relative(vaultPath, fullPath).replace(/\\/g, '/');
      const stat = fs.statSync(fullPath);
      const raw = fs.readFileSync(fullPath, 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);
      const contentPreview = body.trim().slice(0, 300);
      results.push({
        entry_key: relPath,
        title: frontmatter.title || path.basename(entry.name, '.md'),
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        folder: path.dirname(relPath),
        content_preview: contentPreview,
        frontmatter,
        created_at: frontmatter.created ? new Date(frontmatter.created).getTime() : stat.birthtimeMs,
        updated_at: frontmatter.modified ? new Date(frontmatter.modified).getTime() : stat.mtimeMs,
      });
    }
  }
  return results;
}

function scanVault(vaultPath, options = {}) {
  const { q, tag, folder } = options;
  let entries = walkVault(vaultPath, vaultPath);

  if (q) {
    const lower = q.toLowerCase();
    entries = entries.filter(e =>
      e.title.toLowerCase().includes(lower) ||
      e.content_preview.toLowerCase().includes(lower) ||
      e.tags.some(t => t.toLowerCase().includes(lower))
    );
  }
  if (tag) {
    entries = entries.filter(e => e.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
  }
  if (folder) {
    entries = entries.filter(e => e.folder === folder);
  }

  return entries.sort((a, b) => b.updated_at - a.updated_at);
}

function readEntry(vaultPath, entryKey) {
  const { root, target: fullPath } = resolveInsideVault(vaultPath, entryKey);
  if (!fs.existsSync(fullPath)) throw new Error('条目不存在');
  const realPath = fs.realpathSync(fullPath);
  if (!realPath.startsWith(root + path.sep)) throw new Error('路径越界');
  if (!fs.statSync(realPath).isFile()) throw new Error('条目不是文件');
  const stat = fs.statSync(realPath);
  const raw = fs.readFileSync(realPath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    entry_key: entryKey,
    title: frontmatter.title || path.basename(entryKey, '.md'),
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    folder: path.dirname(entryKey),
    content: body,
    frontmatter,
    created_at: frontmatter.created ? new Date(frontmatter.created).getTime() : stat.birthtimeMs,
    updated_at: frontmatter.modified ? new Date(frontmatter.modified).getTime() : stat.mtimeMs,
  };
}

function writeNote(vaultPath, folder, title, tags, content) {
  const date = new Date().toISOString().split('T')[0];
  const { root, target: noteDir } = resolveInsideVault(vaultPath, folder, true);

  fs.mkdirSync(noteDir, { recursive: true });
  const realDir = fs.realpathSync(noteDir);
  if (realDir !== root && !realDir.startsWith(root + path.sep)) throw new Error('路径越界');

  let fileName = `${title}.md`;
  //简单的文件名清理
  fileName = fileName.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  let fullPath = path.join(noteDir, fileName);
  let counter = 1;
  while (fs.existsSync(fullPath)) {
    fileName = `${title}-${counter}.md`.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
    fullPath = path.join(noteDir, fileName);
    counter++;
  }

  const header = formatFrontmatter(title, tags, date);
  fs.writeFileSync(fullPath, header + content, 'utf8');
  return path.relative(root, fullPath).replace(/\\/g, '/');
}

function updateNote(vaultPath, entryKey, title, tags, content) {
  const { root, target: fullPath } = resolveInsideVault(vaultPath, entryKey);
  if (!fs.existsSync(fullPath)) throw new Error('条目不存在');
  const realPath = fs.realpathSync(fullPath);
  if (!realPath.startsWith(root + path.sep)) throw new Error('路径越界');

  const raw = fs.readFileSync(realPath, 'utf8');
  const { frontmatter } = parseFrontmatter(raw);
  const date = frontmatter.created || new Date().toISOString().split('T')[0];

  const header = formatFrontmatter(title, tags, date);
  fs.writeFileSync(realPath, header + content, 'utf8');
  return entryKey;
}

function deleteNote(vaultPath, entryKey) {
  const { root, target: fullPath } = resolveInsideVault(vaultPath, entryKey);
  if (!fs.existsSync(fullPath)) throw new Error('条目不存在');
  const realPath = fs.realpathSync(fullPath);
  if (!realPath.startsWith(root + path.sep)) throw new Error('路径越界');
  fs.unlinkSync(realPath);
  return true;
}

function listFolders(vaultPath) {
  const folders = new Set();
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.obsidian' || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(vaultPath, fullPath).replace(/\\/g, '/');
        folders.add(rel);
        walk(fullPath);
      }
    }
  }
  walk(vaultPath);
  return Array.from(folders).sort();
}

function listAllTags(vaultPath) {
  const tags = new Set();
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.obsidian' || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const { frontmatter } = parseFrontmatter(raw);
        if (Array.isArray(frontmatter.tags)) {
          frontmatter.tags.forEach(t => tags.add(t));
        }
      }
    }
  }
  walk(vaultPath);
  return Array.from(tags).sort();
}

module.exports = {
  scanVault,
  readEntry,
  writeNote,
  updateNote,
  deleteNote,
  listFolders,
  listAllTags,
  parseFrontmatter,
};
