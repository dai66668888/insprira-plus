import { fmt } from '../utils.js';

export function adaptDY(item) {
  return {
    plat: 'dy', workId: item.workId || item.awemeId || item.id,
    title: (item.title || item.content || '').slice(0, 80),
    desc: item.content,
    cover: item.coverUrl,
    author: item.accountName,
    authorId: item.accountId,
    authorAvatar: item.avatarUrl || item.authorUrl,
    authorFans: fmt(item.followerCount),
    like: fmt(item.likeCount),
    comment: fmt(item.commentCount),
    share: fmt(item.shareCount),
    collect: fmt(item.collectCount),
    play: fmt(item.playCount),
    duration: item.duration ? Math.round(item.duration / 1000) + 's' : null,
    publishTime: item.publishTime,
    url: item.workUrl,
    category: item.category,
    isPromotion: item.isPromotion,
    isVideo: true,
  };
}

export function adaptXHS(item) {
  return {
    plat: 'xhs', workId: item.id || item.workId,
    title: (item.title || item.workTitle || (item.desc || item.workDesc || '').slice(0, 30)),
    desc: item.desc || item.workDesc,
    cover: item.cover || item.coverUrl,
    author: item.authorNickname || item.accountNickname,
    authorId: item.authorId || item.accountUserid,
    authorFans: fmt(item.authorFans),
    like: fmt(item.likedCount ?? item.workLikedCount),
    comment: fmt(item.commentsCount ?? item.workCommentsCount),
    share: fmt(item.sharedCount ?? item.workSharedCount),
    collect: fmt(item.collectedCount ?? item.workCollectedCount),
    interactive: fmt(item.interactiveCount),
    url: item.shareInfoLink || item.workUrl,
    createTime: item.createTime || item.workPublishTime,
    relevanceScore: item.relevanceScore,
    popularityScore: item.popularityScore,
    recencyScore: item.recencyScore,
    totalScore: item.totalScore,
    isVideo: false,
  };
}

export function adaptGZH(item) {
  return {
    plat: 'gzh', workId: item.id || item.workUuid,
    title: (item.title || (item.summary || '').slice(0, 30)),
    summary: item.summary,
    content: item.content || item.articleContent || item.htmlContent || item.contentHtml || item.desc,
    cover: item.imageUrl || item.coverUrl,
    author: item.author || item.sourceUsernickname,
    read: fmt(item.clicksCount ?? item.readCount),
    like: fmt(item.likeCount),
    comment: fmt(item.commentsCount),
    watch: fmt(item.watchCount),
    url: item.url || item.workUrl || item.sourceUrl,
    publicTime: item.publicTime || item.publishTime,
    relevanceScore: item.relevanceScore,
    popularityScore: item.popularityScore,
    recencyScore: item.recencyScore,
    totalScore: item.totalScore,
    isVideo: false,
  };
}

export function adaptAIGZH(item) {
  return {
    plat: 'gzh',
    sourcePlat: 'ai-gzh',
    workId: item.photoId,
    title: item.title,
    summary: [item.type, item.topic].filter(Boolean).join(' · '),
    cover: item.coverUrl,
    author: item.userName,
    authorId: item.authorId,
    authorAvatar: item.userHeadUrl,
    read: fmt(item.readCount),
    like: fmt(item.likeCount),
    comment: fmt(item.commentCount),
    share: fmt(item.shareCount),
    url: item.url,
    publicTime: item.gmtCreate,
    isVideo: false,
  };
}

export function adaptAIBili(item) {
  return {
    plat: 'bz',
    sourcePlat: 'ai-bili',
    workId: item.photoId,
    title: item.title,
    summary: [item.type, item.topic].filter(Boolean).join(' · '),
    cover: item.coverUrl,
    author: item.userName,
    authorId: item.authorId,
    authorAvatar: item.userHeadUrl,
    like: fmt(item.likeCount),
    comment: fmt(item.commentCount),
    share: fmt(item.shareCount),
    play: fmt(item.playCount ?? item.viewCount),
    url: item.url || (item.photoId ? `https://www.bilibili.com/video/${item.photoId}` : ''),
    publicTime: item.gmtCreate || item.publishTime,
    isVideo: true,
  };
}

export function adaptAIXHS(item) {
  return {
    plat: 'xhs',
    sourcePlat: 'ai-xhs',
    workId: item.photoId,
    title: item.title,
    desc: [item.type, item.topic].filter(Boolean).join(' · '),
    cover: item.coverUrl,
    author: item.userName,
    authorId: item.authorId,
    authorAvatar: item.userHeadUrl,
    like: fmt(item.likeCount),
    comment: fmt(item.commentCount),
    share: fmt(item.shareCount),
    collect: fmt(item.collectCount),
    url: item.url || (item.photoId ? `https://www.xiaohongshu.com/explore/${item.photoId}` : ''),
    createTime: item.gmtCreate || item.publishTime,
    isVideo: false,
  };
}

export function adaptAiFeed(item, platform) {
  const platMap = {
    'ai-gzh': 'gzh',
    'ai-bili': 'bz',
    'ai-xhs': 'xhs',
    'ai-dy': 'dy',
    'ai-ks': 'ks',
    'ai-sph': 'sph',
    'playlet-dy': 'dy',
    'playlet-gzh': 'gzh',
  };
  const plat = platMap[platform] || platform;
  const isGzhFamily = plat === 'gzh';
  const urlMap = {
    'ai-bili': item.photoId ? `https://www.bilibili.com/video/${item.photoId}` : '',
    'ai-xhs': item.photoId ? `https://www.xiaohongshu.com/explore/${item.photoId}` : '',
    'ai-dy': item.photoId ? `https://www.douyin.com/video/${item.photoId}` : '',
    'ai-ks': item.photoId ? `https://www.kuaishou.com/short-video/${item.photoId}` : '',
    'ai-sph': item.url || '',
    'playlet-dy': item.photoId ? `https://www.douyin.com/video/${item.photoId}` : '',
    'playlet-gzh': item.url || '',
  };
  return {
    plat,
    sourcePlat: platform,
    workId: item.photoId || item.id,
    title: item.title,
    desc: [item.type, item.topic].filter(Boolean).join(' · '),
    cover: item.coverUrl,
    author: item.userName,
    authorId: item.authorId,
    authorAvatar: item.userHeadUrl,
    read: isGzhFamily ? fmt(item.readCount) : undefined,
    like: fmt(item.likeCount),
    comment: fmt(item.commentCount),
    share: fmt(item.shareCount),
    collect: fmt(item.collectCount),
    play: plat === 'bz' ? fmt(item.playCount ?? item.viewCount) : undefined,
    url: urlMap[platform] || item.url || '',
    publicTime: item.gmtCreate || item.publishTime,
    createTime: item.gmtCreate || item.publishTime,
    isVideo: ['dy', 'bz', 'ks', 'sph'].includes(plat),
  };
}
