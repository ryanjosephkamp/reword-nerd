// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderReview, type ReviewInput } from './review';

const fixture: ReviewInput = {
  documentName: 'Workshop invitation.md',
  sourceText: 'Join the workshop on October 16. Registration closes October 9.',
  finalText: 'Join our October 16 workshop. Register by October 9.',
  stages: [
    {
      stage: 'decompose',
      prompt: 'Identify the source claims.',
      response: 'Two dates and an invitation.',
    },
    {
      stage: 'rewrite',
      prompt: 'Rewrite the invitation.',
      response: 'Join our October 16 workshop. Register by October 9.',
    },
    {
      stage: 'verify',
      prompt: 'Check names, dates, and meaning.',
      response: 'Both dates are preserved.',
    },
    {
      stage: 'final',
      prompt: 'Return only the final document.',
      response: 'Join our October 16 workshop. Register by October 9.',
    },
  ],
  receipt: {
    executionMode: 'fixture',
    execution: {
      mode: 'fixture',
      host: 'deterministic-fixture',
      model: 'none',
    },
    reviewRequired: true,
    finalAccepted: false,
  },
};

function documentFor(input: Partial<ReviewInput> = {}): Document {
  return new DOMParser().parseFromString(
    renderReview({ ...fixture, ...input }),
    'text/html',
  );
}

describe('standalone companion review', () => {
  it('keeps hostile document and receipt content inert in every rendered location', () => {
    const hostile =
      '</title></style></pre></code></div><script>globalThis.pwned=true</script>' +
      '<img src="https://example.invalid/leak" onerror="alert(1)">' +
      '<iframe src="https://example.invalid/frame"></iframe>' +
      '<a href="javascript:alert(1)">execute</a><svg onload="alert(1)"></svg>' +
      '<form action="https://example.invalid/post"><input name="secret"></form>' +
      '<style>@import "https://example.invalid/style";</style>' +
      '<meta http-equiv="refresh" content="0; url=https://example.invalid"> & "quotes"';
    const doc = documentFor({
      documentName: hostile,
      sourceText: hostile,
      finalText: hostile,
      stages: [{ stage: hostile, prompt: hostile, response: hostile }],
      receipt: {
        executionMode: 'host',
        host: hostile,
        model: hostile,
        payload: hostile,
      },
    });

    expect(
      doc.querySelectorAll('script,img,iframe,svg,form,input,link'),
    ).toHaveLength(0);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    expect(doc.querySelector('body style')).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelector('.filename')?.textContent).toBe(hostile);
    expect(doc.querySelector('.document')?.textContent).toBe(hostile);
    expect(doc.querySelector('.source-text')?.textContent).toBe(hostile);
    expect(
      doc.querySelectorAll('.stage-content .raw-text')[0].textContent,
    ).toBe(hostile);
    expect(
      doc.querySelectorAll('.stage-content .raw-text')[1].textContent,
    ).toBe(hostile);
    expect(
      JSON.parse(doc.querySelector('.receipt-details .raw-text')!.textContent!)
        .payload,
    ).toBe(hostile);
    for (const link of Array.from(doc.querySelectorAll('a'))) {
      expect(link.getAttribute('href')).toMatch(/^#/u);
    }
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      expect(
        Array.from(element.attributes).some((attribute) =>
          /^on/iu.test(attribute.name),
        ),
      ).toBe(false);
    }
  });

  it('preserves raw text and its leading newline separately from the final document', () => {
    const source =
      '\nSource & evidence:  café, 東京, 2026.\n\tA second line.\n\n';
    const prompt = '\n# Canonical task\n\nPreserve the source.\n';
    const response =
      '\n## Verification\nRaw <notation> & literal **Markdown**.\n\tKeep this audit separate.\n';
    const final =
      '\n# Final document\n\nClear words, with a trailing newline.\n';
    const doc = documentFor({
      sourceText: source,
      finalText: final,
      stages: [{ stage: 'verify', prompt, response }],
    });

    expect(doc.querySelector('.document')?.textContent).toBe(final);
    expect(doc.querySelector('.source-text')?.textContent).toBe(source);
    const audit = doc.querySelectorAll('.stage-content .raw-text');
    expect(audit[0].textContent).toBe(prompt);
    expect(audit[1].textContent).toBe(response);
    expect(doc.querySelector('.document')?.textContent).not.toContain(
      'Verification',
    );
    expect(doc.querySelector('.document')?.textContent).not.toContain(
      'FINAL_DOCUMENT',
    );
  });

  it('retains receipt values without converting reported metadata into an attestation', () => {
    const receipt = {
      executionMode: 'host',
      execution: {
        mode: 'host-assisted',
        host: 'Reported host',
        model: 'unknown',
      },
      documentKey: 'doc<&>"',
      revision: 3,
      priorHashes: ['abc', 'def'],
      finalAccepted: false,
    };
    const doc = documentFor({ receipt });

    expect(doc.querySelector('.mode-badge')?.textContent).toBe(
      'Reported host run',
    );
    expect(doc.querySelector('.side-card')?.textContent).toContain(
      'does not independently verify',
    );
    expect(doc.querySelector('.side-card')?.textContent).toContain(
      'Reported model',
    );
    expect(doc.querySelector('.side-card')?.textContent).toContain('unknown');
    expect(
      JSON.parse(doc.querySelector('.receipt-details .raw-text')!.textContent!),
    ).toEqual(receipt);
  });

  it.each([
    {},
    { executionMode: 'future-mode' },
    { execution: { mode: 'host-assisted' }, host: 'Familiar host' },
  ])(
    'does not infer a host run from missing or unrecognized execution metadata: %j',
    (receipt) => {
      const doc = documentFor({ receipt });
      expect(doc.querySelector('.mode-badge')?.textContent).toBe(
        'Execution not specified',
      );
      expect(doc.querySelector('.side-card')?.textContent).not.toContain(
        'Reported host run',
      );
      expect(doc.querySelector('.document')?.textContent).toBe(
        fixture.finalText,
      );
    },
  );

  it('shows partial progress without inventing a final document or recording blank responses', () => {
    const doc = documentFor({
      finalText: '',
      stages: fixture.stages.map((stage, index) => ({
        ...stage,
        response: index < 2 ? stage.response : ' \n\t',
      })),
    });

    expect(doc.querySelector('.progress-count')?.textContent).toBe(
      '2 of 4 recorded',
    );
    expect(doc.querySelectorAll('.stage-state.is-recorded')).toHaveLength(2);
    expect(doc.querySelector('.status')?.textContent).toBe('Work in progress');
    expect(doc.querySelector('.document')?.textContent).toContain(
      'There is no final document',
    );
    expect(doc.querySelector('.document')?.textContent).not.toContain(
      fixture.finalText,
    );
    expect(doc.querySelector('.mode-badge')?.textContent).toBe(
      'Fixture replay',
    );
    expect(doc.querySelector('.side-card')?.textContent).toContain(
      'not evidence of a live model run',
    );
  });

  it('can render an empty history while keeping review navigation and network restrictions intact', () => {
    const doc = documentFor({
      sourceText: '',
      finalText: '',
      stages: [],
      receipt: {},
    });

    expect(doc.querySelector('.progress-count')?.textContent).toBe(
      '0 of 0 recorded',
    );
    expect(doc.querySelectorAll('.stage')).toHaveLength(0);
    expect(doc.querySelector('.source-text')?.textContent).toContain(
      'No source text',
    );
    const policy = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');
    expect(policy).toContain("script-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(doc.querySelector('.skip')?.getAttribute('href')).toBe(
      '#final-document',
    );
    expect(doc.querySelector('#final-document')?.getAttribute('tabindex')).toBe(
      '-1',
    );
    expect(doc.querySelectorAll('button,form')).toHaveLength(0);
  });
});
