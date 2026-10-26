class WaterHeaterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = Object.assign({
      title: 'Θερμοσίφωνο',
      icon: 'mdi:bathtub-outline',
      entity_switch: '',
      entity_temp: '',
      temp_high: 42,
      temp_mid: 35,
      color_low: '#87CEEB',
      color_mid: '#FFA500',
      color_high: '#FF4500',
      theme: 'default'
    }, config);

    this._renderBase();
  }

  set hass(hass) {
    this._hass = hass;
    this._applyStyles();
    this._updateContent();
  }

  _renderBase() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          border-radius: 20px;
          box-shadow: 0px 6px 20px rgba(0, 0, 0, 0.3);
          color: white;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          transition: transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out, background 0.5s ease;
          user-select: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 120px;
          position: relative;
          overflow: hidden;
        }
        ha-card:hover {
          box-shadow: 0px 8px 25px rgba(0, 0, 0, 0.4);
          transform: scale(1.02);
        }
        .icon-container {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 8px;
        }
        ha-icon {
          --mdc-icon-size: 42px;
          transition: color 0.3s ease, transform 0.3s ease;
        }
        .pulse-ring {
          position: absolute;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.6);
          animation: pulse 2s infinite;
          display: none;
        }
        @keyframes pulse {
          0% { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        .primary-text {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 4px;
          color: #ffffff !important;
        }
        .secondary-text {
          font-size: 16px;
          opacity: 0.9;
          color: #ffffff !important;
        }
        .status-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.25);
          margin-top: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
      </style>
      <ha-card id="card">
        <div class="icon-container">
          <div class="pulse-ring" id="pulse"></div>
          <ha-icon id="icon"></ha-icon>
        </div>
        <div class="primary-text" id="primary"></div>
        <div class="secondary-text" id="secondary"></div>
        <div class="status-badge" id="badge"></div>
      </ha-card>
    `;

    this.shadowRoot.getElementById('card').addEventListener('click', () => this._handleTap());
  }

  // Σκουραίνει ένα HEX χρώμα κατά ποσοστό 0-1, για να φτιάχνει μόνη της τη δεύτερη απόχρωση του
  // gradient από το ΕΝΑ χρώμα που διαλέγει ο χρήστης στον editor — δεν χρειάζεται δεύτερο πεδίο.
  _darken(hex, amount = 0.3) {
    if (!hex) return hex;
    let clean = hex.trim().replace('#', '');
    if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
    if (clean.length !== 6) return hex;
    const r = Math.round(parseInt(clean.substring(0, 2), 16) * (1 - amount));
    const g = Math.round(parseInt(clean.substring(2, 4), 16) * (1 - amount));
    const b = Math.round(parseInt(clean.substring(4, 6), 16) * (1 - amount));
    return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
  }

  _applyStyles() {
    if (!this._hass || !this._config) return;
    const card = this.shadowRoot.getElementById('card');
    const icon = this.shadowRoot.getElementById('icon');
    const pulse = this.shadowRoot.getElementById('pulse');
    if (!card) return;

    // Εφαρμογή Theme
    if (this._config.theme && this._config.theme !== 'default' && this._hass.themes && this._hass.themes.themes[this._config.theme]) {
      const themeVars = this._hass.themes.themes[this._config.theme];
      for (const [key, value] of Object.entries(themeVars)) {
        if (typeof value === 'string') card.style.setProperty(`--${key}`, value);
      }
    }

    const switchEntity = this._hass.states[this._config.entity_switch];
    const tempEntity = this._hass.states[this._config.entity_temp];

    const isCardOn = switchEntity && switchEntity.state === 'on';
    const tempVal = tempEntity ? parseFloat(tempEntity.state) || 0 : 0;

    const highLimit = parseFloat(this._config.temp_high) || 42;
    const midLimit = parseFloat(this._config.temp_mid) || 35;

    const colorLow = this._config.color_low || '#87CEEB';
    const colorMid = this._config.color_mid || '#FFA500';
    const colorHigh = this._config.color_high || '#FF4500';

    // Υπολογισμός Χρώματος/Gradient — βάση + αυτόματα πιο σκούρα απόχρωση (_darken)
    let bgStyle = 'rgba(0, 0, 0, 0.4)';
    let tempColor = colorLow;

    if (tempVal > highLimit) {
      tempColor = colorHigh;
    } else if (tempVal > midLimit) {
      tempColor = colorMid;
    } else {
      tempColor = colorLow;
    }

    if (isCardOn) {
      pulse.style.display = 'block';
      bgStyle = `linear-gradient(135deg, ${tempColor}, ${this._darken(tempColor)})`;
      icon.style.color = '#FFFFFF';
    } else {
      pulse.style.display = 'none';
      bgStyle = 'rgba(0, 0, 0, 0.4)';
      icon.style.color = tempColor; // Όταν είναι OFF, το εικονίδιο δείχνει το χρώμα της θερμοκρασίας
    }

    card.style.background = bgStyle;
  }

  _updateContent() {
    if (!this._hass || !this._config) return;

    const switchEntity = this._hass.states[this._config.entity_switch];
    const tempEntity = this._hass.states[this._config.entity_temp];

    const isCardOn = switchEntity && switchEntity.state === 'on';
    const titleText = this._config.title || 'Θερμοσίφωνο';

    const primaryEl = this.shadowRoot.getElementById('primary');
    const secondaryEl = this.shadowRoot.getElementById('secondary');
    const badgeEl = this.shadowRoot.getElementById('badge');
    const iconEl = this.shadowRoot.getElementById('icon');

    if (primaryEl) primaryEl.textContent = `${titleText} - ${isCardOn ? 'Ενεργό' : 'Ανενεργό'}`;
    if (iconEl) iconEl.setAttribute('icon', this._config.icon || 'mdi:bathtub-outline');

    if (tempEntity && secondaryEl) {
      const tempVal = parseFloat(tempEntity.state);
      secondaryEl.textContent = isNaN(tempVal) ? '-- °C' : `${tempVal.toFixed(1)}°C`;
    } else if (secondaryEl) {
      secondaryEl.textContent = '';
    }

    if (badgeEl) {
      badgeEl.textContent = isCardOn ? 'ΘΕΡΜΑΝΣΗ ΣΕ ΕΞΕΛΙΞΗ' : 'ΑΝΑΜΟΝΗ';
    }
  }

  _handleTap() {
    if (this._config.entity_switch && this._hass) {
      this._hass.callService('switch', 'toggle', {
        entity_id: this._config.entity_switch
      });
    }
  }

  static getConfigElement() {
    return document.createElement('water-heater-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Θερμοσίφωνο',
      icon: 'mdi:bathtub-outline',
      entity_switch: 'switch.sonoff_10000821ae',
      entity_temp: 'sensor.sonoff_10000821ae_temperature',
      temp_high: 42,
      temp_mid: 35,
      color_low: '#87CEEB',
      color_mid: '#FFA500',
      color_high: '#FF4500',
      theme: 'default'
    };
  }

  getCardSize() {
    return 2;
  }
}

// ==========================================
// VISUAL EDITOR (Οπτικός Επεξεργαστής)
// ==========================================
class WaterHeaterCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  render() {
    if (!this._hass || !this._config) return;

    if (!this.rendered) {
      const themeOptions = Object.keys((this._hass.themes && this._hass.themes.themes) || {})
        .map(theme => `<mwc-list-item value="${theme}">${theme}</mwc-list-item>`).join('');

      // Σημείωση: εδώ γράφουμε raw HTML (innerHTML), όχι lit-html — ".value=", ".hass=" και
      // "@input="/"@value-changed=" μέσα σε ένα απλό string ΔΕΝ δουλεύουν ποτέ (μόνο μέσα σε
      // πραγματικά lit-html templates έχουν νόημα). Γι' αυτό πριν δεν ενημερωνόταν ΤΙΠΟΤΑ από τον
      // editor αυτής της κάρτας: ούτε έδειχνε τις τρέχουσες τιμές, ούτε αντιδρούσε σε καμία
      // αλλαγή. Η πραγματική τιμή/hass ορίζεται παρακάτω ως κανονική JS property, και τα events
      // πιάνονται με πραγματικό addEventListener.
      this.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px; padding: 10px;">
          <ha-textfield label="Τίτλος" data-prop="title"></ha-textfield>
          <ha-icon-picker label="Εικονίδιο" data-prop="icon"></ha-icon-picker>
          <ha-entity-picker label="Διακόπτης (Switch Entity)" data-prop="entity_switch" include-domains='["switch", "input_boolean"]'></ha-entity-picker>
          <ha-entity-picker label="Αισθητήρας Θερμοκρασίας (Temp Sensor)" data-prop="entity_temp" include-domains='["sensor"]'></ha-entity-picker>
          <ha-textfield label="Όριο Υψηλής Θερμοκρασίας (°C)" type="number" data-prop="temp_high"></ha-textfield>
          <ha-textfield label="Όριο Μεσαίας Θερμοκρασίας (°C)" type="number" data-prop="temp_mid"></ha-textfield>

          <hr style="border: 0; border-top: 1px solid var(--divider-color); margin: 4px 0;" />
          <span style="font-size: 12px; font-weight: bold; opacity: 0.8;">Χρώμα κάρτας ανά θερμοκρασία:</span>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="color" data-prop="color_low" style="width: 42px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: none;">
            <span style="flex: 1; font-size: 13px;">Χαμηλή (κάτω από το μεσαίο όριο)</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="color" data-prop="color_mid" style="width: 42px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: none;">
            <span style="flex: 1; font-size: 13px;">Μεσαία (ανάμεσα στα δύο όρια)</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="color" data-prop="color_high" style="width: 42px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: none;">
            <span style="flex: 1; font-size: 13px;">Υψηλή (πάνω από το υψηλό όριο)</span>
          </div>

          <ha-select label="Theme" data-prop="theme">
            <mwc-list-item value="default">Default</mwc-list-item>
            ${themeOptions}
          </ha-select>
        </div>
      `;

      this.querySelectorAll('[data-prop]').forEach(el => {
        el.addEventListener('change', this._valueChanged.bind(this));
        el.addEventListener('value-changed', this._valueChanged.bind(this));
        el.addEventListener('selected', this._valueChanged.bind(this));
      });

      this.rendered = true;
    }

    // Πραγματικές JS properties, όχι attributes — τρέχει σε κάθε render() (αρχικό και σε κάθε
    // επόμενη ενημέρωση του hass/config), ώστε ο editor να δείχνει πάντα τις σωστές τιμές.
    this.querySelector('[data-prop="title"]').value = this._config.title || '';
    this.querySelector('[data-prop="icon"]').value = this._config.icon || '';
    this.querySelector('[data-prop="temp_high"]').value = this._config.temp_high !== undefined ? this._config.temp_high : 42;
    this.querySelector('[data-prop="temp_mid"]').value = this._config.temp_mid !== undefined ? this._config.temp_mid : 35;
    this.querySelector('[data-prop="color_low"]').value = this._config.color_low || '#87CEEB';
    this.querySelector('[data-prop="color_mid"]').value = this._config.color_mid || '#FFA500';
    this.querySelector('[data-prop="color_high"]').value = this._config.color_high || '#FF4500';
    this.querySelector('[data-prop="theme"]').value = this._config.theme || 'default';

    const switchPicker = this.querySelector('[data-prop="entity_switch"]');
    switchPicker.hass = this._hass;
    switchPicker.value = this._config.entity_switch || '';

    const tempPicker = this.querySelector('[data-prop="entity_temp"]');
    tempPicker.hass = this._hass;
    tempPicker.value = this._config.entity_temp || '';
  }

  _valueChanged(ev) {
    if (!this._config || !this._hass) return;
    const target = ev.target;
    const configValue = target.getAttribute('data-prop');
    if (!configValue) return;
    let newValue = ev.detail && ev.detail.value !== undefined ? ev.detail.value : target.value;

    if (configValue === 'temp_high' || configValue === 'temp_mid') {
      newValue = parseFloat(newValue);
    }

    if (this._config[configValue] === newValue) return;

    const newConfig = {
      ...this._config,
      [configValue]: newValue
    };

    const event = new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }
}

customElements.define('water-heater-card-editor', WaterHeaterCardEditor);
customElements.define('water-heater-card', WaterHeaterCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'water-heater-card',
  name: 'Water Heater Dynamic Card',
  description: 'Μοντέρνα κάρτα θερμοσίφωνα με δυναμικά gradients, visual editor και υποστήριξη themes.'
});