/** Prewritten illustrations for the sample library; these are never model calls. */
const sampleResults: Record<string, string> = {
  "Urban gardens · sample.md": `# A little greener, together

The unused patch behind our community library could become a small garden—a place to grow food, share skills, and get to know our neighbors.

We could start with a few raised beds of seasonal vegetables and flowers. Everyone would be welcome, with or without gardening experience. Helping might mean watering, sharing seeds, or carrying a bag of soil. People could take part in whatever way works for them.

The benefits would reach beyond the harvest. A garden would offer a meeting place without a price tag. Children could learn how food grows, experienced gardeners could share what they know, and new residents could find an easy way to meet people.

First, we need to make sure the idea is practical. Before planting, we would need permission to use the land, a reliable water source, an accessible layout, an understanding of the soil, and a plan for maintenance across the seasons. Starting small would help keep the work manageable.

This is a proposal, not a finished plan. The next step is to hear from the people who would use the garden and see who wants to help. If there is enough interest, we can agree on a practical design and a modest budget.

A neglected corner could become a shared place to grow food, friendships, and belonging.`,
  "Research abstract · sample.txt": `# Reading rooms with room to choose

This fictional four-week pilot explored whether modest changes to public reading spaces were associated with longer visits. Researchers observed two rooms in a community library. One kept its original layout; the other added movable seating, warmer task lighting, and signs welcoming quiet conversation.

Median visits lasted 34 minutes in the modified room and 26 minutes in the unchanged room. In voluntary exit questionnaires, comfortable seating and a choice of where to sit were the features respondents mentioned most often.

These observations suggest that flexible furnishings may help a space feel welcoming, but they do not establish cause and effect. Room location, visitor preferences, daily attendance, the small sample, and voluntary questionnaire participation may have shaped the results. A larger study using randomized room assignments and observations across multiple seasons would be needed.

Library teams could begin with modest, reversible changes and collect feedback before committing to a wider redesign. All figures and findings in this example are invented.`,
  "Product announcement · sample.md": `# Your next great read, together

Starting next Monday, you can make reading lists with friends in our fictional book club app. Keep recommendations in one place, add notes, and vote on what to read next.

Create a list, name it, and invite people with a private link. Anyone who joins can add books, leave a short note, and vote. The list’s creator can remove books or revoke the link at any time. Lists are private by default and stay out of search results.

Shared lists arrive on the web first. The mobile apps will show existing lists; creating and editing them on mobile will follow in a later update, with no date announced yet.

The free plan includes up to three shared lists. Your personal lists stay as they are. To share one, make a separate shared copy.

Ready to begin? Open your library and choose “New shared list.” Tell us what makes planning your next read easier—and what could work better.

This announcement describes an invented product for demonstration.`,
};

export function studioDemoResponse(name: string): string | undefined {
  const result = sampleResults[name];
  if (!result) return undefined;
  return `<<<FINAL_DOCUMENT>>>\n${result}\n<<<END_FINAL_DOCUMENT>>>\n\n<<<FIDELITY_AUDIT>>>\nMeaning: REVIEW — This is a prewritten illustration for the sample library, not a live model response. Compare it against your current source.\nPreferences: REVIEW — This sample does not adapt to your selected brief.\nAssets and LaTeX: NOT APPLICABLE — Text-only sample.\nRemaining uncertainties: Verify the result yourself before use.\n<<<END_FIDELITY_AUDIT>>>`;
}
