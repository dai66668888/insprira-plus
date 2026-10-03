// 灵感熔炉 · Notion API 客户端
const NOTION_VERSION = '2022-06-28';
const MAX_RICH_TEXT_LENGTH = 2000;
const MAX_BLOCKS_PER_REQUEST = 100;

async function notionFetch(apiKey, path, options = {}, attempt = 0) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    if ([429, 529].includes(response.status) && attempt < 3) {
      const retryAfter = Math.max(1, Number(response.headers.get('retry-after')) || 1);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return notionFetch(apiKey, path, options, attempt + 1);
    }
    const message = payload?.message || payload?.error?.message || `Notion HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function retrieveDatabase(apiKey, databaseId) {
  return notionFetch(apiKey, `/databases/${databaseId}`);
}

function findPropertyName(properties, type, preferredNames = [], allowFallback = false) {
  for (const name of preferredNames) {
    if (properties?.[name]?.type === type) return name;
  }
  if (!allowFallback) return '';
  return Object.entries(properties || {}).find(([, property]) => property.type === type)?.[0] || '';
}

async function getDatabaseSchema(apiKey, databaseId) {
  const database = await retrieveDatabase(apiKey, databaseId);
  return {
    title: findPropertyName(database.properties, 'title', ['Title', 'Name'], true),
    tags: findPropertyName(database.properties, 'multi_select', ['Tags', 'tags']),
    folder: findPropertyName(database.properties, 'rich_text', ['Folder', 'folder']),
  };
}

async function searchPages(apiKey, databaseId, options = {}) {
  if (!databaseId) throw new Error('缺少 Notion Database ID');
  const pages = [];
  let cursor;
  do {
    const body = {
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    };
    if (cursor) body.start_cursor = cursor;
    const result = await notionFetch(apiKey, `/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    pages.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor && pages.length < 500);

  const query = String(options.query || '').trim().toLowerCase();
  const tag = String(options.tag || '').trim().toLowerCase();
  const folder = String(options.folder || '').trim();
  return pages.map(page => ({
    entry_key: page.id,
    title: extractNotionTitle(page),
    tags: extractNotionMultiSelect(page, 'Tags'),
    folder: extractNotionText(page, 'Folder'),
    content_preview: '',
    frontmatter: page.properties,
    created_at: page.created_time ? new Date(page.created_time).getTime() : 0,
    updated_at: page.last_edited_time ? new Date(page.last_edited_time).getTime() : 0,
  })).filter(entry => {
    if (query && !entry.title.toLowerCase().includes(query) && !entry.tags.some(item => item.toLowerCase().includes(query))) return false;
    if (tag && !entry.tags.some(item => item.toLowerCase() === tag)) return false;
    if (folder && entry.folder !== folder) return false;
    return true;
  });
}

async function getAllBlockChildren(apiKey, blockId, depth = 0) {
  const blocks = [];
  let cursor;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const result = await notionFetch(apiKey, `/blocks/${blockId}/children?${query}`);
    for (const block of result.results || []) {
      if (block.has_children && depth < 5) {
        block.children = await getAllBlockChildren(apiKey, block.id, depth + 1);
      }
      blocks.push(block);
    }
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return blocks;
}

function blockToMarkdown(block, depth = 0) {
  const value = block[block.type] || {};
  const text = extractRichText(value.rich_text);
  let line = '';
  if (block.type === 'to_do') line = `[${value.checked ? 'x' : ' '}] ${text}`;
  else if (block.type === 'heading_1') line = `# ${text}`;
  else if (block.type === 'heading_2') line = `## ${text}`;
  else if (block.type === 'heading_3') line = `### ${text}`;
  else if (block.type === 'bulleted_list_item') line = `${'  '.repeat(depth)}- ${text}`;
  else if (block.type === 'numbered_list_item') line = `${'  '.repeat(depth)}1. ${text}`;
  else if (block.type === 'quote') line = `> ${text}`;
  else if (block.type === 'code') line = `\`\`\`${value.language || ''}\n${text}\n\`\`\``;
  else if (block.type === 'paragraph') line = text;
  const children = (block.children || []).map(child => blockToMarkdown(child, depth + 1)).filter(Boolean);
  return [line, ...children].filter(Boolean).join('\n');
}

async function getPage(apiKey, pageId) {
  const page = await notionFetch(apiKey, `/pages/${pageId}`);
  const blocks = await getAllBlockChildren(apiKey, pageId);
  const content = blocks.map(block => blockToMarkdown(block)).filter(Boolean).join('\n');
  return {
    entry_key: page.id,
    title: extractNotionTitle(page),
    tags: extractNotionMultiSelect(page, 'Tags'),
    folder: extractNotionText(page, 'Folder'),
    content,
    frontmatter: page.properties,
    created_at: page.created_time ? new Date(page.created_time).getTime() : 0,
    updated_at: page.last_edited_time ? new Date(page.last_edited_time).getTime() : 0,
  };
}

function splitText(text, maxLength = MAX_RICH_TEXT_LENGTH) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += maxLength) {
    chunks.push(text.slice(offset, offset + maxLength));
  }
  return chunks.length ? chunks : [''];
}

function contentToBlocks(content) {
  if (!String(content || '')) return [];
  const blocks = [];
  for (const paragraph of String(content || '').split(/\n{2,}/)) {
    for (const chunk of splitText(paragraph)) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: chunk ? [{ type: 'text', text: { content: chunk } }] : [],
        },
      });
    }
  }
  return blocks;
}

async function appendBlocks(apiKey, pageId, blocks) {
  for (let offset = 0; offset < blocks.length; offset += MAX_BLOCKS_PER_REQUEST) {
    await notionFetch(apiKey, `/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks.slice(offset, offset + MAX_BLOCKS_PER_REQUEST) }),
    });
  }
}

function buildProperties(schema, title, tags, folder) {
  if (!schema.title) throw new Error('Notion 数据库缺少标题属性');
  const properties = {
    [schema.title]: { title: [{ text: { content: title.slice(0, MAX_RICH_TEXT_LENGTH) } }] },
  };
  if (schema.tags && tags?.length) {
    properties[schema.tags] = { multi_select: tags.slice(0, 100).map(name => ({ name })) };
  }
  if (schema.folder && folder !== undefined) {
    properties[schema.folder] = {
      rich_text: folder ? [{ text: { content: folder.slice(0, MAX_RICH_TEXT_LENGTH) } }] : [],
    };
  }
  return properties;
}

async function createPage(apiKey, databaseId, title, tags = [], folder = '', content = '') {
  const schema = await getDatabaseSchema(apiKey, databaseId);
  const page = await notionFetch(apiKey, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildProperties(schema, title, tags, folder),
    }),
  });
  const blocks = contentToBlocks(content);
  if (blocks.length) await appendBlocks(apiKey, page.id, blocks);
  return page.id;
}

async function updatePage(apiKey, pageId, databaseId, title, tags, folder, content) {
  const schema = await getDatabaseSchema(apiKey, databaseId);
  await notionFetch(apiKey, `/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: buildProperties(schema, title, tags, folder) }),
  });
  if (content !== undefined) {
    const existing = await getAllBlockChildren(apiKey, pageId);
    for (const block of existing) {
      await notionFetch(apiKey, `/blocks/${block.id}`, { method: 'DELETE' });
    }
    await appendBlocks(apiKey, pageId, contentToBlocks(content));
  }
}

async function deletePage(apiKey, pageId) {
  await notionFetch(apiKey, `/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  });
}

function findProperty(page, type, preferredNames, allowFallback = false) {
  const properties = page.properties || {};
  for (const name of preferredNames) {
    if (properties[name]?.type === type || properties[name]?.[type]) return properties[name];
  }
  if (!allowFallback) return null;
  return Object.values(properties).find(property => property?.type === type || property?.[type]);
}

function extractNotionTitle(page) {
  const property = findProperty(page, 'title', ['Title', 'Name', 'title', 'name'], true);
  return property?.title?.map(item => item.plain_text).join('') || '无标题';
}

function extractNotionText(page, key) {
  const property = findProperty(page, 'rich_text', [key, key.toLowerCase()]);
  return property?.rich_text?.map(item => item.plain_text).join('') || '';
}

function extractNotionMultiSelect(page, key) {
  const property = findProperty(page, 'multi_select', [key, key.toLowerCase()]);
  return property?.multi_select?.map(item => item.name) || [];
}

function extractRichText(richText = []) {
  return richText.map(item => item.plain_text || '').join('');
}

module.exports = {
  searchPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  contentToBlocks,
};
