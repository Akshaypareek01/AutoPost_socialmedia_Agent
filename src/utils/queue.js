/**
 * Simple file-based queue for storing generated posts awaiting approval/publishing.
 * In production you can swap this with Redis or a DB — but for ₹2k/mo budget,
 * a JSON file queue is perfectly fine for 1 post/day volume.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const QUEUE_FILE = path.join(__dirname, '../../queue/posts.json');

function readQueue() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      fs.writeFileSync(QUEUE_FILE, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(QUEUE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    logger.error('Failed to read queue', err);
    return [];
  }
}

function writeQueue(items) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    logger.error('Failed to write queue', err);
  }
}

/**
 * Add a post to the queue.
 * @param {Object} post - { id, story, instagramCaption, linkedinPost, hashtags, status, createdAt }
 */
function enqueue(post) {
  const queue = readQueue();
  const item = {
    id: `post_${Date.now()}`,
    status: 'pending_approval', // pending_approval | approved | rejected | published | failed
    createdAt: new Date().toISOString(),
    publishedAt: null,
    attempts: 0,
    ...post,
  };
  queue.push(item);
  writeQueue(queue);
  logger.info(`Queued post: ${item.id} — "${item.story?.title?.slice(0, 60)}"`);
  return item;
}

/**
 * Get all posts with a given status.
 */
function getByStatus(status) {
  return readQueue().filter((p) => p.status === status);
}

/**
 * Update a post's status (and optionally other fields) by ID.
 */
function updatePost(id, updates) {
  const queue = readQueue();
  const idx = queue.findIndex((p) => p.id === id);
  if (idx === -1) {
    logger.warn(`Queue: post ${id} not found`);
    return null;
  }
  queue[idx] = { ...queue[idx], ...updates };
  writeQueue(queue);
  return queue[idx];
}

/**
 * Mark old published/rejected posts as archived (keeps queue lean).
 * Call this once a week or so.
 */
function pruneOldPosts(daysOld = 7) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const queue = readQueue();
  const active = queue.filter((p) => {
    if (['published', 'rejected', 'failed'].includes(p.status)) {
      return new Date(p.createdAt) > cutoff;
    }
    return true;
  });
  writeQueue(active);
  logger.info(`Pruned queue: ${queue.length - active.length} old posts removed`);
}

module.exports = { enqueue, getByStatus, updatePost, readQueue, pruneOldPosts };
