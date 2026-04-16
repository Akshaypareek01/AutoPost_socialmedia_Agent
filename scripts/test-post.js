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

function getAI() {
  const provider = process.env.AI_PROVIDER || 'claude';
  return provider === 'gemini' ? callGemini : callClaude;
}

async function main() {
  console.log('\n🚀 TechPageAuto — Carousel Pipeline Test\n');
  console.log(`   Cover image mode: ${resolveCoverImageMode()} (env COVER_IMAGE_MODE="${process.env.COVER_IMAGE_MODE || ''}")\n`);

  // ── Step 1: Extract 3 facts ───────────────────────────────
  console.log('Step 1: Extracting 3 facts for carousel slides...');
  let facts;
  try {
    facts = await extractFacts(testStory, getAI());
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
    imageUrls = await generateCarouselImages(testStory, facts);
    console.log(`✅ ${imageUrls.length} images uploaded to R2:`);
    imageUrls.forEach((url, i) => console.log(`   Slide ${i + 1}: ${url}`));
    console.log('');
  } catch (err) {
    console.error(`❌ Image generation failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 3: Post carousel to Instagram ───────────────────
  console.log('Step 3: Posting carousel to Instagram...');
  const caption = `🤖 AI is already the default stack in 2025. Swipe to see what's changing ➡️\n\n#ai #tech #developer #nvhotech #buildinpublic #artificialintelligence`;

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
