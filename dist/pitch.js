'use strict';
const slides = Array.from(document.querySelectorAll('.slide'));
const previous = document.getElementById('previous-slide');
const next = document.getElementById('next-slide');
let index = 0;
function showSlide(number) {
  index = Math.max(0, Math.min(slides.length - 1, number));
  slides.forEach((slide, position) => {slide.hidden = position !== index;});
  document.getElementById('slide-number').textContent = (index + 1) + ' / ' + slides.length;
  previous.disabled = index === 0;
  next.disabled = index === slides.length - 1;
}
previous.addEventListener('click', () => showSlide(index - 1));
next.addEventListener('click', () => showSlide(index + 1));
document.getElementById('print-slides').addEventListener('click', () => window.print());
document.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') showSlide(index - 1);
  if (event.key === 'ArrowRight') showSlide(index + 1);
});
showSlide(0);
