'use strict';
const list = document.getElementById('archive-files');
for (const src of window.EMBER_DATA?.sources ?? []) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = src.url;
  link.textContent = src.sensor.toUpperCase() + ' · ' + src.year + ' · ' + src.observations.toLocaleString('en-US') + ' retained detections';
  const digest = document.createElement('small');
  digest.textContent = 'SHA-256 ' + src.sha256;
  item.append(link, digest);
  list.append(item);
}
