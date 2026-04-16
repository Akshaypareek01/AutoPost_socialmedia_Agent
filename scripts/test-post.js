/**
 * Full Pipeline Test
 * Generates carousel (cover + 3 fact slides) → uploads to R2 → posts to Instagram
 *
 * Run: node scripts/test-post.js
 */

require('dotenv').config();
const { generateCarouselImages, resolveCoverImageMode } = require('../src/image/index');
const { extractFacts } = require('../src/generator/facts');
const { callClaude } = require('../src/generator/claude');
const { callGemini } = require('../src/generator/gemini');
const { postCarouselToInstagram, postToInstagram } = require('../src/publisher/instagram');

const testStory = {
  id: 'pipeline_test',
  title: 'AI is changing everything in 2025',
  summary: 'From coding to design to research — AI tools are reshaping how developers work. Here are the biggest shifts happening right now.',
  url: 'https://example.com/ai-2025',
  source: 'test',
};

/**
 * When true, pulls the top ranked story from the real fetcher (HN/RSS/Google News + history),
 * so each run tracks what's actually trending instead of the fixed `testStory`.
 * Enable: `node scripts/test-post.js --live` or `TEST_POST_LIVE=1`.
 * @returns {boolean}
 */
function useLiveStoryFromFetcher() {
  if (process.argv.includes('--live')) return true;
  const v = String(process.env.TEST_POST_LIVE || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Resolve which story to run the pipeline against (fixture vs live fetcher).
 * @returns {Promise<Object>} story object compatible with `extractFacts` / `generateCarouselImages`
 */
async function resolveStory() {
  if (!useLiveStoryFromFetcher()) return testStory;
  const { fetchAllStories } = require('../src/fetcher/index');
  const stories = await fetchAllStories();
  if (!stories.length) {
    console.warn('⚠️  Fetcher returned no fresh stories — falling back to embedded test story.\n');
    return testStory;
  }
  const top = stories[0];
  console.log(`   Live story (${top.source}): ${top.title}\n`);
  return top;
}

function getAI() {
  const provider = process.env.AI_PROVIDER || 'claude';
  return provider === 'gemini' ? callGemini : callClaude;
}

async function main() {
  console.log('\n🚀 TechPageAuto — Carousel Pipeline Test\n');
  console.log(`   Cover image mode: ${resolveCoverImageMode()} (env COVER_IMAGE_MODE="${process.env.COVER_IMAGE_MODE || ''}")`);
  console.log(
    `   Story source: ${useLiveStoryFromFetcher() ? 'live fetcher (--live or TEST_POST_LIVE)' : 'fixed testStory (add --live for trending)'}\n`
  );

  const story = await resolveStory();

  // ── Step 1: Extract 3 facts ───────────────────────────────
  console.log('Step 1: Extracting 3 facts for carousel slides...');
  let facts;
  try {
    facts = await extractFacts(story, getAI());
    console.log(`✅ Got ${facts.length} facts:`);
    facts.forEach((f, i) => console.log(`   Slide ${i + 2}: "${f.headline}" — ${f.body.slice(0, 50)}...`));
    console.log('');
  } catch (err) {
    console.error(`❌ Fact extraction failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 2: Generate carousel images ─────────────────────
  console.log('Step 2: Generating 4 carousel images (cover + 3 fact slides)...');
  let imageUrls;
  try {
    imageUrls = await generateCarouselImages(story, facts);
    console.log(`✅ ${imageUrls.length} images uploaded to R2:`);
    imageUrls.forEach((url, i) => console.log(`   Slide ${i + 1}: ${url}`));
    console.log('');
  } catch (err) {
    console.error(`❌ Image generation failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 3: Post carousel to Instagram ───────────────────
  console.log('Step 3: Posting carousel to Instagram...');
  const headline =
    story.title && story.title.length > 180 ? `${story.title.slice(0, 177)}…` : story.title || 'Tech carousel';
  const caption = `📰 ${headline}\n\nSwipe for the breakdown ➡️\n\n#ai #tech #developer #nvhotech #buildinpublic #artificialintelligence`;

  try {
    let result;
    if (imageUrls.length >= 2) {
      result = await postCarouselToInstagram(caption, imageUrls);
      console.log(`✅ Carousel posted! ${result.slides} slides`);
    } else {
      result = await postToInstagram(caption, imageUrls[0]);
      console.log(`✅ Single post (only 1 image generated)`);
    }
    console.log(`   Media ID: ${result.mediaId}`);
    console.log(`\n🎉 Test complete! Check @nvhotech on Instagram.\n`);
  } catch (err) {
    console.error(`❌ Instagram post failed: ${err.message}`);
    if (err.response?.data) {
      console.error('   API Error:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main().catch(console.error);
