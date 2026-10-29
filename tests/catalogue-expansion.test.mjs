import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../worker/catalog.json' with { type: 'json' };
import research from '../catalog-sources.json' with { type: 'json' };
import { createPodarkusLocal } from '../worker/catalog-engine.js';

const ordinary = createPodarkusLocal(data), wide = createPodarkusLocal(data, true);
const answers = { recipient: 'Подруге', occasion: 'День рождения', style: 'balanced',
  budget: 100000, interests: 'Пока не знаю', exclude: '', age_group: 'adult', gift_kind: 'item' };
const byId = new Map(data.gifts.map(g => [g.id, g]));

test('catalogue contains exactly 1537 distinct gifts and valid topic references', () => {
  assert.equal(data.gifts.length, 1537);
  assert.equal(byId.size, 1537);
  assert.equal(new Set(data.gifts.map(g => g.title.toLocaleLowerCase('ru-RU'))).size, 1537);
  const newGifts = data.gifts.filter(g => /^idea-\d+$/.test(g.id) && Number(g.id.slice(5)) >= 501);
  assert.equal(newGifts.length, 1037);
  const topicIds = new Set(data.details.flatMap(d => d[3]));
  for (const gift of newGifts) {
    assert(topicIds.has(gift.id), gift.title);
    assert(gift.price_max >= gift.price_min && gift.price_min > 0);
  }
  for (const id of topicIds) assert(byId.has(id), id);
  assert.equal(new Set(data.details.map(d => d[0])).size, data.details.length);
});

test('social-inspired ideas retain dated sources and do not claim stock or sales ranks', () => {
  assert(Object.keys(research.gifts).length >= 40);
  for (const [id, info] of Object.entries(research.gifts)) {
    assert(byId.has(id)); assert.equal(info.checked_on, '2026-10-29');
    assert(research.sources[info.source_id].url.startsWith('https://'));
    assert.equal(info.relation, 'editorial_inspiration');
  }
});

test('specific social hobbies find relevant gifts within the first results', () => {
  for (const [query, title] of [['Собирает Labubu', /Labubu/], ['Любит Jellycat', /Jellycat/],
    ['Любит матча', /матча|матчи|тясэн/i], ['Увлекается pen pals', /письм|переписк|почт/i]]) {
    const result = ordinary.recommend({ ...answers, interests: query });
    assert(result.items.some(g => title.test(g.title)), query + ': ' + result.items.map(g => g.title));
  }
});

test('expanded AI candidates are not silently truncated at 500', () => {
  const result = wide.recommend(answers);
  assert(result.items.length > 500);
  assert.equal(result.items.length, result.total_matches);
  assert.equal(result.catalog_count, 1537);
});

test('toy and allergy exclusions apply across the entire expanded candidate list', () => {
  const result = wide.recommend({ ...answers, interests: 'Коллекционные фигурки, украшения и домашняя кофейня', exclude_codes: ['toys', 'allergy'] });
  assert(result.items.length);
  for (const gift of result.items) {
    const source = byId.get(gift.id);
    assert(!source.tags.includes('boardgames'));
    assert(!source.flags.some(f => ['toy', 'food', 'fragrance', 'cosmetics', 'plant', 'flowers', 'wool', 'jewelry', 'rubber'].includes(f)), source.title);
  }
  assert(!result.items.some(g => /Labubu|Jellycat|Sonny Angel|Smiski/.test(g.title)));
});
