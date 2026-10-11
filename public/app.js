const menuButton = document.querySelector('[data-menu-toggle]');
const sidebar = document.querySelector('#sidebar');

menuButton?.addEventListener('click', () => {
  const open = sidebar.classList.toggle('sidebar-open');
  menuButton.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});

const breathingButton = document.querySelector('[data-breath-start]');
const breathingCircle = document.querySelector('[data-breath-circle]');
const breathingLabel = document.querySelector('[data-breath-label]');
const breathingCount = document.querySelector('[data-breath-count]');
let breathingTimer;

breathingButton?.addEventListener('click', () => {
  if (breathingButton.dataset.running === 'true') {
    clearTimeout(breathingTimer);
    breathingButton.dataset.running = 'false';
    breathingButton.innerHTML = 'Begin breathing <span aria-hidden="true">↗</span>';
    breathingCircle.classList.remove('breathing-in', 'breathing-hold', 'breathing-out');
    breathingLabel.textContent = 'Ready';
    breathingCount.textContent = 'A few cycles · stop whenever you like';
    return;
  }

  breathingButton.dataset.running = 'true';
  breathingButton.textContent = 'End the exercise';
  const phases = [
    { label: 'Breathe in', seconds: 4, className: 'breathing-in' },
    { label: 'Hold gently', seconds: 7, className: 'breathing-hold' },
    { label: 'Breathe out', seconds: 8, className: 'breathing-out' }
  ];
  let phaseIndex = 0;
  let cycle = 1;
  let remaining = phases[0].seconds;

  const tick = () => {
    const phase = phases[phaseIndex];
    breathingCircle.classList.remove('breathing-in', 'breathing-hold', 'breathing-out');
    breathingCircle.classList.add(phase.className);
    breathingLabel.textContent = `${phase.label} · ${remaining}`;
    breathingCount.textContent = `Cycle ${cycle} of 3 · stop whenever you like`;
    remaining -= 1;
    if (remaining < 0) {
      phaseIndex += 1;
      if (phaseIndex === phases.length) {
        phaseIndex = 0;
        cycle += 1;
      }
      if (cycle > 3) {
        breathingButton.click();
        breathingLabel.textContent = 'Well done';
        breathingCount.textContent = 'Notice how you feel. Continue at your own pace.';
        return;
      }
      remaining = phases[phaseIndex].seconds;
    }
    breathingTimer = window.setTimeout(tick, 1000);
  };
  tick();
});

const chatForm = document.querySelector('[data-chat-form]');
const chatMessages = document.querySelector('[data-chat-messages]');
const chatInput = chatForm?.querySelector('textarea');
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

function addChatMessage(text, sender, crisis = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `chat-message ${sender}${crisis ? ' crisis-message' : ''}`;
  if (sender === 'assistant') {
    const mark = document.createElement('span');
    mark.className = 'chat-message-mark';
    mark.textContent = '✳';
    wrapper.append(mark);
  }
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  wrapper.append(paragraph);
  chatMessages.append(wrapper);
  wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return wrapper;
}

chatForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  addChatMessage(message, 'user');
  chatInput.value = '';
  const pending = addChatMessage('A moment…', 'assistant');
  const submitButton = chatForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ message, _csrf: csrfToken })
    });
    const result = await response.json();
    pending.remove();
    addChatMessage(result.reply || 'I’m here with you. Try again in a moment.', 'assistant', result.crisis);
  } catch {
    pending.remove();
    addChatMessage('I’m having trouble responding just now. Take a slow breath, and consider reaching out to someone you trust.', 'assistant');
  } finally {
    submitButton.disabled = false;
    chatInput.focus();
  }
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    chatInput.value = button.dataset.prompt;
    chatForm.requestSubmit();
  });
});