import { useState } from 'react';
import { TIER_LABEL } from '../../lib/tier';
import { reportUrl, type Facility, type Inspection } from '../../lib/types';
import { formatDate, placeType, plural, prettyStreet } from '../util';
import { TierIcon } from './TierIcon';

const TIER_SUMMARY = {
  clean: 'Inspectors found nothing out of compliance.',
  minor: 'Only upkeep and cleanliness issues. Nothing on the list of foodborne-illness risks.',
  risk: 'At least one practice linked to foodborne illness was out of compliance.',
  unknown: "We couldn't read the results of this report. Open the city's copy for details.",
};

function Findings({ insp }: { insp: Inspection }) {
  const notes = (n: string) => insp.observations.filter((o) => o.n === n);
  const groups = [
    { title: 'Foodborne-illness risk factors', items: insp.violations.filter((v) => v.risk) },
    { title: 'Good retail practices', items: insp.violations.filter((v) => !v.risk) },
  ].filter((g) => g.items.length);

  if (!groups.length) return null;
  return (
    <div className="findings">
      {groups.map((g) => (
        <section key={g.title} className={`finding-group ${g.items[0].risk ? 'is-risk' : ''}`}>
          <h4>
            {g.title} <span className="count">{g.items.length}</span>
          </h4>
          <ul>
            {g.items.map((v) => (
              <li key={v.n}>
                <p className="finding-title">{v.desc}</p>
                {(v.repeat || v.cos) && (
                  <p className="flags">
                    {v.repeat && <span className="flag flag-repeat">Repeat from last inspection</span>}
                    {v.cos && <span className="flag flag-cos">Fixed during the visit</span>}
                  </p>
                )}
                {notes(v.n).map((o, i) => (
                  <p key={i} className="note">
                    {o.text.replace(/\s*(New|Repeat) Violation\.?\s*$/i, '')}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Counts({ insp }: { insp: Inspection }) {
  const risk = insp.violations.filter((v) => v.risk).length;
  const retail = insp.violations.length - risk;
  if (!insp.violations.length) return null;
  return (
    <dl className="counts">
      <div>
        <dt>Risk factors</dt>
        <dd>{risk}</dd>
      </div>
      <div>
        <dt>Retail practices</dt>
        <dd>{retail}</dd>
      </div>
      <div>
        <dt>Repeats</dt>
        <dd>{insp.violations.filter((v) => v.repeat).length}</dd>
      </div>
    </dl>
  );
}

function HistoryRow({ insp }: { insp: Inspection }) {
  const [open, setOpen] = useState(false);
  const risk = insp.violations.filter((v) => v.risk).length;
  return (
    <li className={`history-row ${open ? 'is-open' : ''}`}>
      <button className="history-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <TierIcon tier={insp.tier} size={18} />
        <span className="history-date">{formatDate(insp.date)}</span>
        <span className="history-meta">
          {insp.purpose ?? 'Inspection'}
          {insp.violations.length ? `, ${plural(risk, 'risk factor')}, ${plural(insp.violations.length - risk, 'retail issue')}` : ', no violations'}
        </span>
      </button>
      {open && (
        <div className="history-body">
          <p className="tier-line">
            <strong>{TIER_LABEL[insp.tier]}.</strong> {TIER_SUMMARY[insp.tier]}
          </p>
          <Findings insp={insp} />
          <a className="report-link" href={reportUrl(insp.id)} target="_blank" rel="noreferrer">
            Read the city's report for {formatDate(insp.date)}
          </a>
        </div>
      )}
    </li>
  );
}

export function FacilityDetail({ facility, onBack }: { facility: Facility; onBack: () => void }) {
  const [latest, ...older] = facility.inspections;
  const type = placeType(facility.estType);
  return (
    <article className="detail" aria-labelledby="detail-name">
      <button className="back" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to results
      </button>

      <header className="detail-head">
        <h2 id="detail-name">{facility.name}</h2>
        <p className="detail-address">
          {prettyStreet(facility.street)}, {facility.city} {facility.zip}
        </p>
        <p className="detail-sub">
          {type}
          {type && facility.phone ? ', ' : ''}
          {facility.phone && <a href={`tel:${facility.phone.replace(/[^\d]/g, '')}`}>{facility.phone}</a>}
        </p>
      </header>

      {latest ? (
        <>
          <section className={`placard placard-${latest.tier}`} aria-label="Latest inspection">
            <div className="placard-band">Latest inspection, {formatDate(latest.date)}</div>
            <div className="placard-body">
              <TierIcon tier={latest.tier} size={56} />
              <div>
                <p className="placard-tier">{TIER_LABEL[latest.tier]}</p>
                <p className="placard-summary">{TIER_SUMMARY[latest.tier]}</p>
                <p className="placard-purpose">{latest.purpose === 'Reinspection' ? 'Follow-up visit' : 'Routine visit'}</p>
              </div>
            </div>
            <Counts insp={latest} />
          </section>

          <Findings insp={latest} />

          <a className="report-link" href={reportUrl(latest.id)} target="_blank" rel="noreferrer">
            Read the city's full report
          </a>

          {older.length > 0 && (
            <section className="history">
              <h3>Earlier inspections</h3>
              <ul>
                {older.map((i) => (
                  <HistoryRow key={i.id} insp={i} />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="empty">No food inspections on record in the last three years.</p>
      )}
    </article>
  );
}
