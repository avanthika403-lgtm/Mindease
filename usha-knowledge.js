const wellnessKnowledge = [
  {
    title: 'WHO: Doing What Matters in Times of Stress',
    keywords: ['stress', 'overwhelmed', 'anxious', 'anxiety', 'grounding', 'difficult', 'cope', 'calm'],
    guidance: 'The WHO guide offers brief, practical skills for grounding, unhooking from difficult thoughts, making room for emotions, and acting on personal values.',
    url: 'https://www.who.int/publications/i/item/9789240003927'
  },
  {
    title: 'NIMH: Caring for Your Mental Health',
    keywords: ['mental health', 'self care', 'self-care', 'sleep', 'exercise', 'routine', 'professional', 'help'],
    guidance: 'NIMH describes general self-care practices and signs that it may be helpful to seek professional support.',
    url: 'https://www.nimh.nih.gov/health/topics/caring-for-your-mental-health'
  },
  {
    title: 'NHS: Every Mind Matters',
    keywords: ['worry', 'low mood', 'mood', 'sleep', 'stress', 'wellbeing', 'well-being', 'breathing'],
    guidance: 'The NHS provides general wellbeing suggestions and resources for managing stress, anxiety, and low mood.',
    url: 'https://www.nhs.uk/every-mind-matters/'
  },
  {
    title: '988 Suicide & Crisis Lifeline',
    keywords: ['crisis', 'suicide', 'suicidal', 'self harm', 'self-harm', 'unsafe', 'danger'],
    guidance: 'People in the United States can call or text 988 for free, confidential support during emotional distress or a suicidal crisis.',
    url: 'https://988lifeline.org/'
  },
  {
    title: 'Find A Helpline',
    keywords: ['helpline', 'crisis line', 'support line', 'someone to talk', 'country', 'outside us', 'outside the us'],
    guidance: 'Find A Helpline helps people locate verified emotional-support and crisis services in many countries.',
    url: 'https://findahelpline.com/'
  }
];

function retrieveWellnessResources(text, limit = 3) {
  const normalized = String(text || '').toLowerCase();
  return wellnessKnowledge
    .map((resource) => ({
      resource,
      score: resource.keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? keyword.includes(' ') ? 2 : 1 : 0), 0)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ resource }) => resource);
}

module.exports = { retrieveWellnessResources };
