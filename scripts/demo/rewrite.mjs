// The demo's Word document and the result its agent "writes": a polished rewrite and the report
// an agent leaves next to it. Both written by hand for the demo; no model produced either.
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const ORIGINAL = {
  title: "A little greener, together",
  paragraphs: [
    "There is a patch of unused land behind the community library that most of us walk past without giving it much thought. Right now, it is mostly gravel, a few weeds, and a bench that has seen better days. But it could become something that brings our neighborhood together: a small community garden.",
    "The idea is simple. We would build a few raised beds, plant seasonal vegetables and flowers, and invite neighbors to help look after them. No gardening experience would be necessary. People could contribute in whatever way works for them, whether that means watering on a Tuesday morning, sharing seeds, or helping someone carry a bag of soil.",
    "A garden would give us more than fresh tomatoes. It would create a place where people can meet without needing to buy anything. Children could discover where food comes from. Older residents could share the knowledge they have gathered over years of growing things. And people who have recently moved here would have an easy way to get to know their neighbors.",
    "We should start small. Before we plant anything, we need permission to use the land, a reliable water source, and a plan for keeping the space accessible. We also need to understand the soil conditions and decide who will maintain the garden through different seasons. A few well-cared-for beds would be better than a large project that becomes difficult to manage.",
  ],
  heading: "What we need first",
  needs: [
    ["Need", "Why"],
    ["Permission to use the land", "The lot belongs to the library."],
    ["A reliable water source", "Raised beds dry out quickly in summer."],
    ["A care schedule", "Someone has to look after the beds every season."],
  ],
  closing: [
    "This is a proposal, not a finished plan. The next step is to gather ideas from the people who would use the garden and find out who wants to take part. If there is enough interest, we can work together on a practical design and a modest budget.",
    "An overlooked corner of our neighborhood could become a place to grow food, friendships, and a stronger sense of belonging.",
  ],
};

const PARAGRAPHS = [
  "Behind the community library sits an empty lot that most of us pass without a second glance. Today it holds gravel, a scattering of weeds, and a worn-out bench. With a little work, it could become a small community garden that draws the neighborhood together.",
  "The plan is straightforward: a handful of raised beds, seasonal vegetables and flowers, and neighbors who share the care. No one needs gardening experience. Everyone can help in the way that suits them, whether that is watering on a Tuesday morning, trading seeds, or carrying a bag of soil for someone else.",
  "The benefits go well beyond fresh tomatoes. A garden offers a place to meet that costs nothing. Children can learn where their food comes from, longtime residents can pass on what years of growing have taught them, and newcomers gain an easy way to meet the people next door.",
  "We should begin modestly. Before planting, we need permission to use the land, a dependable water supply, and a plan to keep the space accessible. We also need to learn about the soil and agree on who will tend the garden from season to season. A few well-kept beds will serve us better than an ambitious project that grows hard to manage.",
];

const NEEDS = [
  ["Need", "Why"],
  ["Permission to use the land", "The library owns the lot."],
  ["A dependable water supply", "Raised beds dry out fast in summer."],
  ["A care schedule", "The beds need tending every season."],
];

const CLOSING = [
  "This is a proposal, not a finished plan. Next, we will collect ideas from the people who would use the garden and learn who wants to be involved. If enough people are interested, we can draw up a practical design and a modest budget together.",
  "A forgotten corner of our neighborhood could grow food, friendships, and a deeper sense of belonging.",
];

export const REPORT = [
  "File: garden-proposal.docx",
  "Meaning: PASS — every point, need, and reason is kept; nothing is added",
  "Settings: PASS — polished and confident; about the same length",
  "Open questions: None",
  "",
].join("\n");

function buildDocx({ title, paragraphs, heading, needs, closing }) {
  const paragraph = (text) => new Paragraph({ children: [new TextRun(text)] });
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: needs.map(
      (cells, row) =>
        new TableRow({
          tableHeader: row === 0,
          children: cells.map(
            (text) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text, bold: row === 0 })] })],
              }),
          ),
        }),
    ),
  });
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(title)] }),
          ...paragraphs.map(paragraph),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(heading)] }),
          table,
          ...closing.map(paragraph),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

/** The document the demo starts from: the sample garden proposal, without its picture. */
export function originalDocx() {
  return buildDocx(ORIGINAL);
}

export function rewrittenDocx() {
  return buildDocx({
    title: "Greener together",
    paragraphs: PARAGRAPHS,
    heading: "First steps",
    needs: NEEDS,
    closing: CLOSING,
  });
}
