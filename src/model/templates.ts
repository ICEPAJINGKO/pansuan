import type { AssetNode, Portfolio } from '../types'
import { ROOT_COLOR } from '../lib/palette'
import { uid } from '../lib/id'
import { ROOT_ID } from './portfolio'

type Seed = [name: string, percent: number, color: string, children?: Seed[]]

function build(seed: Seed): AssetNode {
  const [name, value, color, children] = seed
  return {
    id: uid(),
    name,
    mode: 'percent',
    value,
    color,
    children: (children ?? []).map(build),
  }
}

function portfolio(name: string, capital: number, seeds: Seed[]): Portfolio {
  return {
    version: 1,
    name,
    currency: 'THB',
    capital,
    root: { id: ROOT_ID, name: 'เงินทุนตั้งต้น', mode: 'amount', value: 0, color: ROOT_COLOR, children: seeds.map(build) },
    updatedAt: Date.now(),
  }
}

export interface Template {
  key: string
  label: string
  hint: string
  make: () => Portfolio
}

export const TEMPLATES: Template[] = [
  {
    key: 'blank',
    label: 'เริ่มจากศูนย์',
    hint: 'ทุนอย่างเดียว แล้วค่อยแตกเอง',
    make: () => portfolio('พอร์ตของฉัน', 1_000_000, []),
  },
  {
    key: 'classic',
    label: 'คลาสสิก 60/40',
    hint: 'หุ้น 60 · ตราสารหนี้ 40',
    make: () =>
      portfolio('คลาสสิก 60/40', 1_000_000, [
        [
          'หุ้น',
          60,
          '#7c5cff',
          [
            ['หุ้นโลก (VT)', 55, '#a78bfa'],
            ['หุ้นสหรัฐ (VOO)', 30, '#c084fc'],
            ['หุ้นไทย (SET50)', 15, '#f472b6'],
          ],
        ],
        [
          'ตราสารหนี้',
          40,
          '#22d3ee',
          [
            ['พันธบัตรรัฐบาล', 60, '#38bdf8'],
            ['หุ้นกู้เอกชน', 40, '#2dd4bf'],
          ],
        ],
      ]),
  },
  {
    key: 'allweather',
    label: 'All Weather',
    hint: 'กระจายทนได้ทุกสภาพตลาด',
    make: () =>
      portfolio('All Weather', 1_000_000, [
        ['หุ้น', 30, '#7c5cff'],
        ['พันธบัตรระยะยาว', 40, '#22d3ee'],
        ['พันธบัตรระยะกลาง', 15, '#38bdf8'],
        ['ทองคำ', 7.5, '#fbbf24'],
        ['สินค้าโภคภัณฑ์', 7.5, '#fb7185'],
      ]),
  },
  {
    key: 'growth',
    label: 'สายลุย',
    hint: 'เน้นโต รับความผันผวนได้',
    make: () =>
      portfolio('สายลุย', 1_000_000, [
        [
          'หุ้นเติบโต',
          55,
          '#7c5cff',
          [
            ['เทคโนโลยีสหรัฐ', 50, '#a78bfa'],
            ['หุ้นจีน/เอเชีย', 25, '#f472b6'],
            ['Small Cap', 25, '#c084fc'],
          ],
        ],
        [
          'คริปโต',
          20,
          '#fbbf24',
          [
            ['BTC', 65, '#facc15'],
            ['ETH', 35, '#f59e0b'],
          ],
        ],
        ['หุ้นปันผล', 15, '#34d399'],
        ['เงินสด / กองทุนตลาดเงิน', 10, '#60a5fa'],
      ]),
  },
]
