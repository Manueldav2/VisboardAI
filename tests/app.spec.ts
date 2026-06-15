import { test, expect } from '@playwright/test';

test.describe('Thought Plot — App Load & UI', () => {
  test('page loads with correct title and core elements', async ({ page }) => {
    await page.goto('/');

    // Title
    await expect(page).toHaveTitle('Thought Plot');

    // Header elements
    await expect(page.locator('.logo h1')).toHaveText('Thought Plot');
    await expect(page.locator('.tagline')).toHaveText('conversations into structure');

    // Core controls exist
    await expect(page.locator('.mic-btn')).toBeVisible();
    await expect(page.locator('.text-input')).toBeVisible();
    await expect(page.locator('.send-btn')).toBeVisible();

    // Diagram area exists
    await expect(page.locator('.diagram-view')).toBeVisible();
    await expect(page.locator('.diagram-empty')).toBeVisible();
    await expect(page.locator('.diagram-empty p')).toContainText('Start speaking or paste text');

    // Panel tabs
    await expect(page.locator('.panel-tab').first()).toContainText('Transcript');
    await expect(page.locator('.panel-tab').last()).toContainText('Insights');

    // Status indicator shows Ready
    await expect(page.locator('.status-indicator')).toContainText('Ready');
  });

  test('control buttons are all present', async ({ page }) => {
    await page.goto('/');

    // Session, Paste, New buttons
    const sessionsBtn = page.locator('button', { hasText: 'Sessions' });
    const pasteBtn = page.locator('button', { hasText: 'Paste' });
    const newBtn = page.locator('button', { hasText: 'New' });

    await expect(sessionsBtn).toBeVisible();
    await expect(pasteBtn).toBeVisible();
    await expect(newBtn).toBeVisible();
  });

  test('empty state panels show placeholder text', async ({ page }) => {
    await page.goto('/');

    // Transcript tab (default)
    await expect(page.locator('.transcript-empty')).toBeVisible();
    await expect(page.locator('.transcript-empty')).toContainText('Transcript will appear');

    // Switch to Insights tab
    await page.locator('.panel-tab', { hasText: 'Insights' }).click();
    await expect(page.locator('.fact-panel-empty')).toBeVisible();
    await expect(page.locator('.fact-panel-empty')).toContainText('Facts, actions, corrections');
  });
});

test.describe('Thought Plot — Text Input', () => {
  test('can type and send text via input field', async ({ page }) => {
    await page.goto('/');

    const input = page.locator('.text-input');
    const sendBtn = page.locator('.send-btn');

    // Send button should be disabled when input is empty
    await expect(sendBtn).toBeDisabled();

    // Type text
    await input.fill('Hello, this is a test message');
    await expect(sendBtn).not.toBeDisabled();

    // Send it
    await sendBtn.click();

    // Input should be cleared
    await expect(input).toHaveValue('');

    // Transcript should show the message
    await expect(page.locator('.transcript-entry')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.transcript-text').first()).toContainText('Hello, this is a test message');
    await expect(page.locator('.transcript-speaker').first()).toContainText('You');
  });

  test('can send text via Enter key', async ({ page }) => {
    await page.goto('/');

    const input = page.locator('.text-input');
    await input.fill('Testing Enter key');
    await input.press('Enter');

    await expect(input).toHaveValue('');
    await expect(page.locator('.transcript-entry')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.transcript-text').first()).toContainText('Testing Enter key');
  });

  test('send button stays disabled for whitespace-only input', async ({ page }) => {
    await page.goto('/');

    const input = page.locator('.text-input');
    const sendBtn = page.locator('.send-btn');

    await input.fill('   ');
    await expect(sendBtn).toBeDisabled();
  });
});

test.describe('Thought Plot — Paste Modal', () => {
  test('can open and close paste modal', async ({ page }) => {
    await page.goto('/');

    // Open paste modal
    await page.locator('button', { hasText: 'Paste' }).click();
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal-textarea')).toBeVisible();

    // Close it with the ghost button (Cancel)
    await page.locator('.modal .btn-ghost').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
  });

  test('can paste text and trigger analysis', async ({ page }) => {
    await page.goto('/');

    // Open paste modal
    await page.locator('button', { hasText: 'Paste' }).click();

    // Type a factual conversation into the textarea
    const textarea = page.locator('.modal-textarea');
    await textarea.fill(
      'The Eiffel Tower was built in 1889 in Paris, France. ' +
      'It was designed by Gustave Eiffel and stands about 330 meters tall. ' +
      'It is the most visited paid monument in the world with about 7 million visitors per year.'
    );

    // Click analyze
    const analyzeBtn = page.locator('.modal .btn-primary');
    await expect(analyzeBtn).not.toBeDisabled();
    await analyzeBtn.click();

    // Modal should close
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 10000 });

    // Wait for extraction to complete — diagram should appear
    await expect(page.locator('.diagram-empty')).not.toBeVisible({ timeout: 30000 });

    // Diagram SVG should be rendered
    await expect(page.locator('.diagram-svg svg')).toBeVisible({ timeout: 30000 });

    // Stats should show nodes and edges
    await expect(page.locator('.diagram-stats')).toBeVisible();
    const statsText = await page.locator('.diagram-stats').textContent();
    expect(statsText).toMatch(/\d+ nodes/);
    expect(statsText).toMatch(/\d+ edges/);

    // Type badge should show diagram type
    await expect(page.locator('.diagram-type-badge')).toBeVisible();

    // The app auto-switches to Insights tab after paste, so check transcript via tab switch
    await page.locator('.panel-tab', { hasText: 'Transcript' }).click();
    await expect(page.locator('.transcript-entry').first()).toBeVisible({ timeout: 5000 });

    // Switch to Insights — should have fact checks and summary
    await page.locator('.panel-tab', { hasText: 'Insights' }).click();

    // Wait for insights to populate
    await expect(page.locator('.panel-section').first()).toBeVisible({ timeout: 15000 });

    // Summary should exist
    await expect(page.locator('.summary-text')).toBeVisible({ timeout: 10000 });
    const summaryText = await page.locator('.summary-text').textContent();
    expect(summaryText!.length).toBeGreaterThan(10);
  });
});

test.describe('Thought Plot — Diagram Interaction', () => {
  test('zoom controls work', async ({ page }) => {
    await page.goto('/');

    // Send text to generate a diagram
    const input = page.locator('.text-input');
    await input.fill(
      'I want to build a web app with a React frontend, a Node.js backend, and a PostgreSQL database. ' +
      'The frontend sends REST API requests to the backend, which queries the database.'
    );
    await input.press('Enter');

    // Wait for diagram
    await expect(page.locator('.diagram-svg svg')).toBeVisible({ timeout: 30000 });

    // Check zoom label starts at 100%
    await expect(page.locator('.zoom-label')).toContainText('100%');

    // Click zoom in
    await page.locator('.diagram-controls button').first().click();
    const zoomText = await page.locator('.zoom-label').textContent();
    expect(parseInt(zoomText!)).toBeGreaterThan(100);

    // Click zoom out
    await page.locator('.diagram-controls button').nth(1).click();

    // Reset view
    await page.locator('.diagram-controls button').nth(2).click();
    await expect(page.locator('.zoom-label')).toContainText('100%');
  });
});

test.describe('Thought Plot — Diagram Quality (Subject, Not Conversation)', () => {
  test('diagrams the subject matter, not the conversation itself', async ({ page }) => {
    await page.goto('/');

    // Send a message about building an AI app
    const input = page.locator('.text-input');
    await input.fill(
      'I want to build an AI application where multiple AI agents communicate with each other. ' +
      'Agent A processes user input and sends it to Agent B for analysis. ' +
      'Agent B then queries a vector database and returns results to Agent A, ' +
      'which formats the response for the user.'
    );
    await input.press('Enter');

    // Wait for diagram
    await expect(page.locator('.diagram-svg svg')).toBeVisible({ timeout: 30000 });

    // Get all node labels from the rendered SVG
    const svgContent = await page.locator('.diagram-svg').innerHTML();
    const svgLower = svgContent.toLowerCase();

    // Should NOT contain conversation meta-nodes
    expect(svgLower).not.toContain('user said');
    expect(svgLower).not.toContain('user speaks');
    expect(svgLower).not.toContain('conversation started');
    expect(svgLower).not.toContain('user wants');

    // SHOULD contain subject-matter nodes — at least some of these
    const subjectTerms = ['agent', 'database', 'user input', 'analysis', 'response', 'query', 'vector', 'process'];
    const matchCount = subjectTerms.filter(term => svgLower.includes(term)).length;
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });

  test('political conversation produces conceptual diagram', async ({ page }) => {
    await page.goto('/');

    await page.locator('button', { hasText: 'Paste' }).click();
    await page.locator('.modal-textarea').fill(
      'Alice: I think universal basic income could reduce poverty significantly.\n' +
      'Bob: But it could cause inflation and discourage people from working.\n' +
      'Alice: Studies in Finland showed employment actually stayed the same.\n' +
      'Bob: The US economy is different though. We have higher costs of living.\n' +
      'Alice: True, but the poverty reduction data from those studies is compelling.'
    );
    await page.locator('.modal .btn-primary').click();

    // Wait for extraction to complete — check for diagram stats (node/edge count shows even if SVG fails)
    await expect(page.locator('.diagram-stats')).toBeVisible({ timeout: 30000 });
    const statsText = await page.locator('.diagram-stats').textContent();
    expect(statsText).toMatch(/\d+ nodes/);

    // The type badge should show a proper title about the concepts
    await expect(page.locator('.diagram-type-badge')).toBeVisible();
    const badgeText = (await page.locator('.diagram-type-badge').textContent())!.toLowerCase();
    expect(badgeText).not.toContain('alice said');
    expect(badgeText).not.toContain('bob said');

    // Check Insights tab has correct conceptual summary
    await page.locator('.panel-tab', { hasText: 'Insights' }).click();
    await expect(page.locator('.summary-text')).toBeVisible({ timeout: 15000 });
    const summaryText = (await page.locator('.summary-text').textContent())!.toLowerCase();

    // Summary should be about UBI/poverty/economics, not about "Alice and Bob talking"
    const conceptTerms = ['ubi', 'universal basic income', 'poverty', 'inflation', 'employment', 'economy', 'finland'];
    const matchCount = conceptTerms.filter(term => summaryText.includes(term)).length;
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Thought Plot — Fact Checking', () => {
  test('detects and flags factual claims for verification', async ({ page }) => {
    await page.goto('/');

    // Paste text with verifiable facts
    await page.locator('button', { hasText: 'Paste' }).click();
    await page.locator('.modal-textarea').fill(
      'The Great Wall of China was built in 1200 BC and is visible from space. ' +
      'It stretches for about 13,000 miles. The wall was primarily built during the Ming Dynasty. ' +
      'Python programming language was created by Guido van Rossum in 1991.'
    );
    await page.locator('.modal .btn-primary').click();

    // Wait for extraction
    await expect(page.locator('.diagram-svg svg')).toBeVisible({ timeout: 30000 });

    // Switch to Insights tab
    await page.locator('.panel-tab', { hasText: 'Insights' }).click();

    // Should have fact checks — wait for them to appear
    await expect(page.locator('.fact-item').first()).toBeVisible({ timeout: 20000 });

    // Should have at least 2 fact check items
    const factItems = page.locator('.fact-item');
    const count = await factItems.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Each fact check should have a status badge
    for (let i = 0; i < Math.min(count, 3); i++) {
      const badge = factItems.nth(i).locator('.fact-badge');
      await expect(badge).toBeVisible();
      const badgeText = await badge.textContent();
      expect(['checking', 'verified', 'wrong', 'unverified']).toContain(badgeText!.trim());
    }

    // Wait longer for background verification to complete
    await page.waitForTimeout(15000);

    // After verification, at least one should have a confidence score
    const confidenceScores = page.locator('.fact-confidence');
    const confCount = await confidenceScores.count();
    expect(confCount).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Thought Plot — Session Management', () => {
  test('can open session panel and create new session', async ({ page }) => {
    await page.goto('/');

    // Open sessions panel
    await page.locator('button', { hasText: 'Sessions' }).click();
    await expect(page.locator('.session-sidebar')).toBeVisible();

    // Should have a new session button
    await expect(page.locator('.session-panel-header')).toBeVisible();

    // Close sessions
    await page.locator('button', { hasText: 'Sessions' }).click();
    await expect(page.locator('.session-sidebar')).not.toBeVisible();
  });

  test('new session button resets the state', async ({ page }) => {
    await page.goto('/');

    // Send a message first
    const input = page.locator('.text-input');
    await input.fill('This is a test message for session management');
    await input.press('Enter');
    await expect(page.locator('.transcript-entry')).toBeVisible({ timeout: 5000 });

    // Click New
    await page.locator('button', { hasText: 'New' }).click();

    // Transcript should be cleared
    await expect(page.locator('.transcript-empty')).toBeVisible();

    // Diagram should be empty
    await expect(page.locator('.diagram-empty')).toBeVisible();
  });
});

test.describe('Thought Plot — Panel Switching', () => {
  test('can switch between Transcript and Insights tabs', async ({ page }) => {
    await page.goto('/');

    // Default: Transcript tab is active
    const transcriptTab = page.locator('.panel-tab', { hasText: 'Transcript' });
    const insightsTab = page.locator('.panel-tab', { hasText: 'Insights' });

    await expect(transcriptTab).toHaveClass(/active/);
    await expect(insightsTab).not.toHaveClass(/active/);

    // Switch to Insights
    await insightsTab.click();
    await expect(insightsTab).toHaveClass(/active/);
    await expect(transcriptTab).not.toHaveClass(/active/);
    await expect(page.locator('.fact-panel-empty')).toBeVisible();

    // Switch back
    await transcriptTab.click();
    await expect(transcriptTab).toHaveClass(/active/);
    await expect(page.locator('.transcript-empty')).toBeVisible();
  });
});
