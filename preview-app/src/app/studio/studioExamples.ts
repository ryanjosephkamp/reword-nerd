export interface StudioExample {
  id: string;
  name: string;
  title: string;
  label?: string;
  category: string;
  description: string;
  text: string;
}

/** Fictional, explicitly labeled source material; never presented as a model result. */
export const STUDIO_EXAMPLES: readonly StudioExample[] = [
  {
    id: "garden",
    name: "Urban gardens · sample.md",
    title: "A little greener, together",
    label: "Community story",
    category: "An everyday idea",
    description: "Turn a thoughtful community proposal into a clear, compelling story.",
    text: `# A little greener, together

There is a patch of unused land behind the community library that most of us walk past without giving it much thought. Right now, it is mostly gravel, a few weeds, and a bench that has seen better days. But it could become something that brings our neighborhood together: a small community garden.

The idea is simple. We would build a few raised beds, plant seasonal vegetables and flowers, and invite neighbors to help look after them. No gardening experience would be necessary. People could contribute in whatever way works for them, whether that means watering on a Tuesday morning, sharing seeds, or helping someone carry a bag of soil.

A garden would give us more than fresh tomatoes. It would create a place where people can meet without needing to buy anything. Children could discover where food comes from. Older residents could share the knowledge they have gathered over years of growing things. And people who have recently moved here would have an easy way to get to know their neighbors.

We should start small. Before we plant anything, we need permission to use the land, a reliable water source, and a plan for keeping the space accessible. We also need to understand the soil conditions and decide who will maintain the garden through different seasons. A few well-cared-for beds would be better than a large project that becomes difficult to manage.

This is a proposal, not a finished plan. The next step is to gather ideas from the people who would use the garden and find out who wants to take part. If there is enough interest, we can work together on a practical design and a modest budget.

An overlooked corner of our neighborhood could become a place to grow food, friendships, and a stronger sense of belonging.`,
  },
  {
    id: "research",
    name: "Research abstract · sample.txt",
    title: "Make research resonate",
    label: "Research abstract",
    category: "A research abstract",
    description: "Keep the findings precise while making the language more approachable.",
    text: `# Make research resonate

This fictional study examines how small changes in the design of public reading spaces may influence visitors' willingness to remain in those spaces. Over a four-week pilot, we observed usage patterns in two reading rooms at a community library. One room retained its existing arrangement, while the other received movable seating, warmer task lighting, and clear signs indicating that quiet conversation was welcome.

Visitors in the modified room stayed for a median of 34 minutes, compared with 26 minutes in the unchanged room. In voluntary exit questionnaires, respondents most frequently mentioned comfortable seating and the ability to choose where to sit. These observations suggest that adaptable furnishings may contribute to a more welcoming environment.

The pilot does not establish a causal relationship. Room location, visitor preferences, and differences in daily attendance may have influenced the results. The sample was small, and questionnaire participation was voluntary. A larger study with randomized room assignments and observations across multiple seasons would be needed to test whether the pattern persists.

For library teams considering similar changes, the findings support trying modest, reversible adjustments and gathering feedback before investing in a wider redesign. All figures and findings in this passage are invented for demonstration.`,
  },
  {
    id: "email",
    name: "Product announcement · sample.md",
    title: "Less jargon. More connection.",
    label: "Product announcement",
    category: "A product announcement",
    description: "Give a feature update a friendly voice without changing its promises.",
    text: `# Introducing shared reading lists

Starting next Monday, members of our fictional book club app will be able to create reading lists with friends. Instead of sending book recommendations across several conversations, you can keep them in one place and decide what to read next together.

Create a list, give it a name, and invite people with a private link. Anyone who joins can add a book, leave a short note, and vote for the next group read. The person who created the list can remove books or revoke the invitation link at any time. Lists are private by default and do not appear in search results.

Shared lists will be available on the web first. Mobile apps will display existing lists, but creating and editing lists on mobile will arrive in a later update. We have not announced a date for that update yet.

You can create up to three shared lists on the free plan. Existing personal reading lists will remain unchanged. If you want to share one of them, you can make a separate shared copy.

To get started, open your library and choose “New shared list.” We would love to hear what makes organizing your next read easier, and what still feels complicated. This entire announcement describes an invented product for demonstration.`,
  },
] as const;

export const studioExamples = STUDIO_EXAMPLES;
