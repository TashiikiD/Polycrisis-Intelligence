/**
 * PaywallManager - Stripe-based tiered access control
 * 
 * Features:
 * - Stripe Checkout integration
 * - Tier management (free/basic/pro/enterprise)
 * - Paywall modal UI
 * - Server-side session validation
 * - Integration with TimelineSlider and EventArchive
 * 
 * Usage:
 *   const paywall = new PaywallManager({
 *     stripePublishableKey: 'pk_live_...',
 *     apiEndpoint: '/api/v1/billing'
 *   });
 *   await paywall.init();
 *   
 *   // Check access
 *   if (!paywall.canAccessHistorical(90)) {
 *     paywall.showPaywall({ daysRequested: 90 });
 *   }
 */

class PaywallManager {
    constructor(options = {}) {
        this.stripeKey = options.stripePublishableKey || '';
        this.apiEndpoint = options.apiEndpoint || '/api/v1/billing';
        this.redirectUrl = options.redirectUrl || window.location.href;
        
        // Tier configuration
        this.tiers = {
            free: {
                name: 'Free',
                price: 0,
                maxDays: 30,
                features: ['30-day event history', 'Basic WSSI score', 'Daily digest']
            },
            basic: {
                name: 'Basic',
                price: 9,
                maxDays: 1825, // 5 years
                features: [
                    '5-year historical archive',
                    'Full dashboard access',
                    'PDF exports',
                    'API access (usage based)'
                ]
            },
            pro: {
                name: 'Pro',
                price: 20,
                maxDays: 1825,
                features: [
                    '5-year historical archive',
                    'Full dashboard access',
                    'PDF exports',
                    'API access (1K/day included)',
                    'Priority support'
                ]
            },
            enterprise: {
                name: 'Enterprise',
                price: 149,
                maxDays: 3650, // 10 years
                features: [
                    '10-year historical archive',
                    'Custom dashboards',
                    'Priority API (unlimited)',
                    'White-label options',
                    'Dedicated support'
                ]
            }
        };
        
        // Current user state
        this.currentTier = 'free';
        this.sessionId = null;
        this.customerId = null;
        this.subscriptionStatus = null;
        
        // Stripe instance
        this.stripe = null;
        
        // UI state
        this.modalOpen = false;
    }

    /**
     * Initialize paywall manager
     */
    async init() {
        // Load Stripe.js if not present
        if (this.stripeKey && typeof Stripe === 'undefined') {
            await this._loadStripe();
        }
        
        if (this.stripeKey && typeof Stripe !== 'undefined') {
            this.stripe = Stripe(this.stripeKey);
        }
        
        // Check for existing session from URL
        const urlParams = new URLSearchParams(window.location.search);
        this.sessionId = urlParams.get('session_id');
        
        if (this.sessionId) {
            await this._verifySession();
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            // Check stored tier
            await this._loadStoredTier();
        }
        
        return this;
    }

    /**
     * Check if user can access historical data for N days
     */
    canAccessHistorical(days) {
        const maxDays = this.tiers[this.currentTier]?.maxDays || 30;
        return days <= maxDays;
    }

    /**
     * Get current tier info
     */
    getCurrentTier() {
        return {
            tier: this.currentTier,
            ...this.tiers[this.currentTier],
            subscriptionStatus: this.subscriptionStatus
        };
    }

    /**
     * Show paywall modal
     */
    showPaywall(options = {}) {
        const { daysRequested = 90, trigger = 'timeline' } = options;
        
        this.modalOpen = true;
        
        // Create modal if not exists
        let modal = document.getElementById('paywall-modal');
        if (!modal) {
            modal = this._createModal();
            document.body.appendChild(modal);
        }
        
        // Update content based on trigger
        this._updateModalContent(modal, { daysRequested, trigger });
        
        // Show modal
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }

    /**
     * Hide paywall modal
     */
    hidePaywall() {
        this.modalOpen = false;
        const modal = document.getElementById('paywall-modal');
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => modal.style.display = 'none', 300);
        }
    }

    /**
     * Initiate checkout for tier upgrade
     */
    async checkout(tier) {
        if (!this.tiers[tier]) {
            console.error(`Unknown tier: ${tier}`);
            return;
        }
        if (tier === 'enterprise') {
            window.location.href = 'mailto:sales@polycrisis.io?subject=Enterprise%20Plan%20Inquiry';
            return;
        }

        const apiKey = localStorage.getItem('wssi_api_key') || localStorage.getItem('api_key') || '';
        if (!apiKey) {
            this._showError('No API key found. Sign up or log in first.');
            return;
        }

        try {
            const response = await fetch(`${this.apiEndpoint}/checkout-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify({
                    tier,
                    success_url: `${window.location.origin}/app/index.html?checkout=success#ledger`,
                    cancel_url: `${window.location.origin}/pricing/index.html?checkout=cancel`
                })
            });
            const data = await response.json();

            if (!response.ok) {
                const msg = data?.detail?.message || data?.detail || 'Checkout failed';
                this._showError(msg);
                return;
            }
            if (data.checkout_url) {
                window.location.href = data.checkout_url;
                return;
            }
            this._showError('Checkout URL was not returned.');
        } catch (err) {
            console.error('Checkout failed:', err);
            this._showError('Unable to start checkout. Please try again.');
        }
    }

    /**
     * Downgrade to free tier
     */
    async downgrade() {
        try {
            const response = await fetch(`${this.apiEndpoint}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });
            
            if (response.ok) {
                this.currentTier = 'free';
                this.subscriptionStatus = 'canceled';
                this._storeTier();
                this._emit('tierChanged', { tier: 'free' });
                return true;
            }
        } catch (err) {
            console.error('Downgrade failed:', err);
        }
        return false;
    }

    /**
     * Create paywall modal DOM
     */
    _createModal() {
        const modal = document.createElement('div');
        modal.id = 'paywall-modal';
        modal.className = 'paywall-modal';
        modal.innerHTML = `
            <div class="paywall-backdrop"></div>
            <div class="paywall-content">
                <button class="paywall-close">×</button>
                <div class="paywall-header">
                    <h2>Unlock Historical Data</h2>
                    <p class="paywall-subtitle">Access the complete 5-year polycrisis archive</p>
                </div>
                <div class="paywall-tiers"></div>
                <div class="paywall-footer">
                    <p>Secure payment via Stripe. Cancel anytime.</p>
                </div>
            </div>
        `;
        
        // Add styles
        if (!document.getElementById('paywall-styles')) {
            const styles = document.createElement('style');
            styles.id = 'paywall-styles';
            styles.textContent = this._getStyles();
            document.head.appendChild(styles);
        }
        
        // Event listeners
        modal.querySelector('.paywall-backdrop').addEventListener('click', () => this.hidePaywall());
        modal.querySelector('.paywall-close').addEventListener('click', () => this.hidePaywall());
        
        return modal;
    }

    /**
     * Update modal content
     */
    _updateModalContent(modal, options) {
        const { daysRequested } = options;
        const tiersContainer = modal.querySelector('.paywall-tiers');
        
        const currentMax = this.tiers[this.currentTier].maxDays;
        const neededTier = daysRequested <= 30 ? 'free' : daysRequested <= 1825 ? 'basic' : 'enterprise';
        
        tiersContainer.innerHTML = Object.entries(this.tiers)
            .filter(([key]) => key !== 'free')
            .map(([key, tier]) => {
                const isRecommended = key === neededTier;
                const isCurrent = key === this.currentTier;
                
                return `
                    <div class="paywall-tier ${isRecommended ? 'recommended' : ''} ${isCurrent ? 'current' : ''}">
                        ${isRecommended ? '<span class="tier-badge">Recommended</span>' : ''}
                        ${isCurrent ? '<span class="tier-badge current">Current Plan</span>' : ''}
                        <h3>${tier.name}</h3>
                        <div class="tier-price">$${tier.price}<span>/month</span></div>
                        <ul class="tier-features">
                            ${tier.features.map(f => `<li>${f}</li>`).join('')}
                        </ul>
                        <button class="tier-cta" data-tier="${key}" ${isCurrent ? 'disabled' : ''}>
                            ${isCurrent ? 'Current Plan' : 'Upgrade'}
                        </button>
                    </div>
                `;
            }).join('');
        
        // Add click handlers
        tiersContainer.querySelectorAll('.tier-cta').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tier = e.target.dataset.tier;
                this.checkout(tier);
            });
        });
        
        // Update header
        const subtitle = modal.querySelector('.paywall-subtitle');
        if (daysRequested > currentMax) {
            subtitle.textContent = `You're trying to access ${daysRequested} days of history. Upgrade to unlock.`;
        }
    }

    /**
     * Verify checkout session with backend
     */
    async _verifySession() {
        await this._loadStoredTier();
    }

    /**
     * Load tier from storage
     */
    async _loadStoredTier() {
        const stored = localStorage.getItem('wssi_tier') || localStorage.getItem('paywall_tier');
        if (stored) {
            this.currentTier = stored;
        }
    }

    /**
     * Store tier locally
     */
    _storeTier() {
        localStorage.setItem('paywall_tier', this.currentTier);
    }

    /**
     * Load Stripe.js
     */
    _loadStripe() {
        return new Promise((resolve, reject) => {
            if (typeof Stripe !== 'undefined') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://js.stripe.com/v3/';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Emit event
     */
    _emit(eventName, detail) {
        window.dispatchEvent(new CustomEvent(`paywall:${eventName}`, { detail }));
    }

    /**
     * Show error message
     */
    _showError(message) {
        // Simple alert for now - could be a toast notification
        alert(message);
    }

    /**
     * Get CSS styles
     */
    _getStyles() {
        return `
            .paywall-modal {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 10000;
                align-items: center;
                justify-content: center;
                padding: 2rem;
            }
            
            .paywall-modal.active {
                display: flex;
            }
            
            .paywall-backdrop {
                position: absolute;
                inset: 0;
                background: rgba(0,0,0,0.8);
                backdrop-filter: blur(4px);
            }
            
            .paywall-content {
                position: relative;
                background: var(--bg-secondary, #1a1a2e);
                border: 1px solid var(--border, #333);
                border-radius: 16px;
                max-width: 800px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                padding: 2rem;
                transform: scale(0.95);
                opacity: 0;
                transition: all 0.3s ease;
            }
            
            .paywall-modal.active .paywall-content {
                transform: scale(1);
                opacity: 1;
            }
            
            .paywall-close {
                position: absolute;
                top: 1rem;
                right: 1rem;
                background: none;
                border: none;
                color: var(--text-secondary, #8892b0);
                font-size: 1.5rem;
                cursor: pointer;
                padding: 0.5rem;
                line-height: 1;
            }
            
            .paywall-close:hover {
                color: var(--text-primary, #e6f1ff);
            }
            
            .paywall-header {
                text-align: center;
                margin-bottom: 2rem;
            }
            
            .paywall-header h2 {
                font-size: 1.75rem;
                margin-bottom: 0.5rem;
            }
            
            .paywall-subtitle {
                color: var(--text-secondary, #8892b0);
            }
            
            .paywall-tiers {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 1.5rem;
                margin-bottom: 2rem;
            }
            
            .paywall-tier {
                background: var(--bg-void, #0a0a0f);
                border: 1px solid var(--border, #333);
                border-radius: 12px;
                padding: 1.5rem;
                position: relative;
            }
            
            .paywall-tier.recommended {
                border-color: var(--accent-primary, #64ffda);
                box-shadow: 0 0 20px rgba(100, 255, 218, 0.1);
            }
            
            .paywall-tier.current {
                opacity: 0.7;
            }
            
            .tier-badge {
                position: absolute;
                top: -10px;
                right: 1rem;
                background: var(--accent-primary, #64ffda);
                color: var(--bg-void, #0a0a0f);
                font-size: 0.75rem;
                font-weight: 600;
                padding: 0.25rem 0.75rem;
                border-radius: 20px;
            }
            
            .tier-badge.current {
                background: var(--text-secondary, #8892b0);
            }
            
            .paywall-tier h3 {
                font-size: 1.25rem;
                margin-bottom: 0.5rem;
            }
            
            .tier-price {
                font-size: 2rem;
                font-weight: 700;
                color: var(--accent-primary, #64ffda);
                margin-bottom: 1rem;
            }
            
            .tier-price span {
                font-size: 0.875rem;
                color: var(--text-secondary, #8892b0);
                font-weight: 400;
            }
            
            .tier-features {
                list-style: none;
                margin: 0 0 1.5rem;
                padding: 0;
            }
            
            .tier-features li {
                padding: 0.5rem 0;
                border-bottom: 1px solid var(--border, #333);
                font-size: 0.875rem;
            }
            
            .tier-features li:before {
                content: "✓";
                color: var(--accent-primary, #64ffda);
                margin-right: 0.5rem;
            }
            
            .tier-cta {
                width: 100%;
                padding: 0.75rem;
                background: var(--accent-primary, #64ffda);
                color: var(--bg-void, #0a0a0f);
                border: none;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                transition: opacity 0.2s;
            }
            
            .tier-cta:hover:not(:disabled) {
                opacity: 0.9;
            }
            
            .tier-cta:disabled {
                background: var(--border, #333);
                color: var(--text-secondary, #8892b0);
                cursor: not-allowed;
            }
            
            .paywall-footer {
                text-align: center;
                color: var(--text-muted, #64748b);
                font-size: 0.75rem;
            }
        `;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaywallManager;
} else {
    window.PaywallManager = PaywallManager;
}
