import { events } from './catalog.js';
import { setMapNight, focusZone } from './mapa.js';

const modal = document.querySelector('#modal');
const modalTitle = document.querySelector('#modal-title');
const content = document.querySelector('#modal-content');
const grid = document.querySelector('#lounge-grid');
const tabs = [...document.querySelectorAll('[role=tab]')];
let active = 'viernes';
let opener;

function openDialog(title, body) {
  opener = document.activeElement;
  modalTitle.textContent = title;
  content.replaceChildren(body);
  modal.showModal();
}

modal.querySelector('.close').addEventListener('click', () => modal.close());
modal.addEventListener('click', event => {
  if (event.target === modal) modal.close();
});
modal.addEventListener('close', () => {
  content.querySelector('video')?.pause();
  content.replaceChildren();
  opener?.focus();
});

function showImage(title, asset, map = false) {
  const wrapper = document.createElement('div');
  const img = document.createElement('img');
  img.className = 'large-flyer';
  img.alt = title;
  img.src = '/assets/' + asset + '.webp';
  wrapper.append(img);
  if (map) {
    const note = document.createElement('p');
    note.textContent = 'Plano de referencia. Confirma el número de mesa y el precio con TRIP al reservar.';
    wrapper.append(note);
  }
  openDialog(title, wrapper);
}

function reserve(item) {
  const event = events[active];
  const wrapper = document.createElement('div');
  const info = document.createElement('p');
  info.textContent = event.title + ' · ' + event.date + ' · ' + item[2] + ' Bs';
  const note = document.createElement('p');
  note.textContent = 'El equipo de TRIP te confirma la mesa y te indica cómo completar el pago.';
  const link = document.createElement('a');
  link.className = 'button solid';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Consultar por WhatsApp →';
  const message = 'Hola, TRIP. Quiero consultar disponibilidad para ' + event.title + ' (' + event.date + '), opción ' + item[1] + ' de ' + item[2] + ' Bs. ¿Qué mesas tienen disponibles y cómo puedo confirmar la reserva?';
  link.href = 'https://wa.me/59170785815?text=' + encodeURIComponent(message);
  wrapper.append(info, note, link);
  openDialog(item[1], wrapper);
}

function render(night) {
  setMapNight(night);
  active = night;
  const event = events[night];
  tabs.forEach(tab => {
    const selected = tab.dataset.tab === night;
    tab.setAttribute('aria-selected', selected);
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelector('#lounge-panel').setAttribute('aria-labelledby', 'tab-' + night);
  document.querySelector('#lounge-note').textContent = event.note;
  grid.replaceChildren(...event.zones.map((item, i) => {
    const [zone, name, price, description, color] = item;
    const card = document.createElement('article');
    card.className = 'lounge-card';
    card.style.setProperty('--zone', color);
    card.innerHTML = '<span class="index">ZONA 0' + (i + 1) + '</span><h3></h3><strong></strong><p></p><button type="button" class="button ghost">Ver en el mapa <span aria-hidden="true">→</span></button>';
    card.querySelector('h3').textContent = name;
    card.querySelector('strong').textContent = price + ' Bs';
    card.querySelector('p').textContent = description;
    const button = card.querySelector('button');
    button.setAttribute('aria-label', 'Ver zona ' + name + ' en el mapa');
    button.addEventListener('click', () => focusZone(zone));
    return card;
  }));
  document.querySelector('#birthday-price').textContent = event.birthday[2] + ' Bs';
  document.querySelector('#birthday-includes').replaceChildren(...event.birthday[3].map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

for (const tab of tabs) {
  tab.addEventListener('click', () => render(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - tabs.indexOf(tab);
    render(tabs[index].dataset.tab);
    tabs[index].focus();
  });
}
for (const button of document.querySelectorAll('[data-night]')) {
  button.addEventListener('click', () => {
    render(button.dataset.night);
    const selected = document.getElementById('tab-' + active);
    selected.focus({ preventScroll: true });
    document.querySelector('#lounges').scrollIntoView();
  });
}
document.querySelector('#map-button').addEventListener('click', () => showImage('Plano · ' + events[active].title, events[active].map, true));
document.querySelector('#birthday-book').addEventListener('click', () => reserve(events[active].birthday));

for (const button of document.querySelectorAll('[data-flyer]')) {
  button.addEventListener('click', () => showImage(button.dataset.title, button.dataset.flyer));
}
for (const button of document.querySelectorAll('[data-video]')) {
  button.addEventListener('click', () => {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.poster = '/assets/' + button.dataset.video + '.webp';
    video.src = '/assets/' + button.dataset.video + '.mp4';
    openDialog(button.dataset.title, video);
    video.play().catch(() => {});
  });
}
const returnEvent = new URLSearchParams(location.search).get('evento');
render(returnEvent === 'sabado' ? 'sabado' : active);
