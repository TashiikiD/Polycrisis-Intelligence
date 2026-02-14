/**
 * Research Feedback Collector
 * Lightweight feedback widget for Research Library
 */

class ResearchFeedback {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.feedbackData = [];
    this.init();
  }

  init() {
    this.renderWidget();
    this.loadExistingFeedback();
  }

  renderWidget() {
    this.container.innerHTML = `
      <div class="feedback-widget">
        <h3>Help Improve Research Quality</h3>
        <div class="feedback-form">
          <select id="feedback-type">
            <option value="quality">Content Quality</option>
            <option value="missing">Missing Paper</option>
            <option value="error">Data Error</option>
            <option value="suggestion">Suggestion</option>
          </select>
          <textarea id="feedback-text" placeholder="Your feedback..."></textarea>
          <button onclick="feedbackCollector.submit()">Submit Feedback</button>
        </div>
        <div id="feedback-status"></div>
      </div>
    `;
  }

  async submit() {
    const type = document.getElementById('feedback-type').value;
    const text = document.getElementById('feedback-text').value;
    
    if (!text.trim()) return;

    const entry = {
      id: Date.now(),
      type,
      text,
      timestamp: new Date().toISOString(),
      page: window.location.pathname
    };

    this.feedbackData.push(entry);
    
    // Save to localStorage (temporary) + attempt server save
    localStorage.setItem('research_feedback', JSON.stringify(this.feedbackData));
    
    try {
      await this.saveToServer(entry);
      document.getElementById('feedback-status').innerHTML = 
        '<span class="success">✓ Feedback saved. Thank you!</span>';
    } catch (e) {
      document.getElementById('feedback-status').innerHTML = 
        '<span class="pending">✓ Saved locally. Will sync when online.</span>';
    }

    document.getElementById('feedback-text').value = '';
  }

  async saveToServer(entry) {
    // Placeholder for server integration
    // In production: POST to /api/feedback
    console.log('Feedback entry:', entry);
    return true;
  }

  loadExistingFeedback() {
    const saved = localStorage.getItem('research_feedback');
    if (saved) {
      this.feedbackData = JSON.parse(saved);
    }
  }

  exportToJson() {
    return JSON.stringify(this.feedbackData, null, 2);
  }
}

// Initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('research-feedback');
  if (container) {
    window.feedbackCollector = new ResearchFeedback('research-feedback');
  }
});
