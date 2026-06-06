import {
  getDashboardRunDetail,
  type DashboardBugBrief,
  type DashboardDiagnosis,
  type DashboardIntakePackage,
  type DashboardMediaArtifact,
  type DashboardObservation,
  type DashboardRunEvent
} from '@/lib/dashboard/read-model';
import { formatDate, PIPELINE_STAGES, prettyJson, stageState, statusLabel, statusTone } from '@/lib/dashboard/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Renders the evidence, report, diagnosis, agent, PR, and timeline detail for one Reflex run.
 *
 * @param params Dynamic route params containing the run ID.
 * @returns Server-rendered run detail page or a not-found page.
 * @sideEffects Reads from InsForge when backend credentials are configured.
 */
export default async function RunDetail({ params }: { params: { runId: string } }) {
  const detail = await getDashboardRunDetail(params.runId);
  if (!detail) return <div className="panel">Run not found.</div>;

  const {
    source,
    error,
    run,
    events,
    chatHistory,
    mediaArtifacts,
    bugBriefs,
    intakePackages,
    observations,
    diagnoses,
    hypotheses,
    agentRuns,
    pullRequests
  } = detail;

  const brief = bugBriefs[0];
  const intakePackage = intakePackages[0];
  const diagnosis = diagnoses[0];
  const observation = observations[0];
  const pullRequest = pullRequests[0];
  const pageTitle = diagnosis?.symptom ?? brief?.actual_behavior ?? (run.command_text || run.run_key);
  const mediaCount = mediaArtifacts.length;
  const contextCount = chatHistory.length + observations.length;

  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">Run detail</p>
          <h1>{pageTitle}</h1>
          <p className="muted">
            {run.run_key} · <span className="pill">{run.mode}</span> {run.role} ·{' '}
            {run.repo_url.replace('https://github.com/', '')}
          </p>
        </div>
        <div className="title-actions">
          <span className={`status-pill ${statusTone(run.status)}`}>{statusLabel(run.status)}</span>
          <span className={`pill ${source === 'insforge' ? 'good' : 'warn'}`}>
            {source === 'insforge' ? 'InsForge' : 'Demo fixture'}
          </span>
        </div>
      </div>

      {error && <div className="panel notice">Showing fixture data because InsForge is not connected: {error}</div>}

      <div className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">Context</span>
          <strong>{contextCount}</strong>
          <span className="metric-note">chat + observations</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Evidence</span>
          <strong>{mediaCount}</strong>
          <span className="metric-note">screenshots / recordings</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Hypotheses</span>
          <strong>{hypotheses.length}</strong>
          <span className="metric-note">ranked by confidence</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">PR proof</span>
          <strong>{pullRequest ? 'Yes' : 'No'}</strong>
          <span className="metric-note">{pullRequest ? 'linked below' : 'not opened yet'}</span>
        </div>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Pipeline</h2>
            <p className="muted">The same state machine drives Slack updates and this dashboard.</p>
          </div>
        </div>
        <div className="stage-rail">
          {PIPELINE_STAGES.map((stage) => {
            const state = stageState(run.status, stage.status);
            return (
              <div className={`stage ${state}`} key={stage.status}>
                <span className="stage-dot" />
                <strong>{stage.label}</strong>
                <span>{stage.detail}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="detail-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Confirmed report</h2>
              <p className="muted">The human-approved package before any agent spends tokens.</p>
            </div>
            {brief && <span className={`status-pill ${statusTone(brief.status)}`}>{statusLabel(brief.status)}</span>}
          </div>
          {brief ? <ReportFields brief={brief} intakePackage={intakePackage} /> : <EmptySection label="No report drafted yet." />}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Normalized observation</h2>
              <p className="muted">What Reflex extracted from Slack or the recording.</p>
            </div>
          </div>
          {observation ? <ObservationView observation={observation} /> : <EmptySection label="No observation stored yet." />}
        </section>
      </div>

      {brief?.agent_prompt_preview && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Agent prompt preview</h2>
              <p className="muted">This is the prompt seed produced after report normalization.</p>
            </div>
          </div>
          <pre className="prompt-box">{brief.agent_prompt_preview}</pre>
        </section>
      )}

      <div className="detail-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Slack context</h2>
              <p className="muted">Copied chat history used to draft the report.</p>
            </div>
          </div>
          {chatHistory.length > 0 ? (
            <div className="message-list">
              {chatHistory.map((message) => (
                <article className="message-row" key={message.id}>
                  <div>
                    <strong>{message.slack_user_id ?? 'unknown user'}</strong>
                    <span className="muted">{message.slack_message_ts}</span>
                  </div>
                  <p>{message.text}</p>
                  <div className="row">
                    {message.has_files && <span className="pill">has files</span>}
                    {message.permalink && <a className="link" href={message.permalink}>open in Slack</a>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptySection label="No Slack messages copied for this run." />
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Evidence artifacts</h2>
              <p className="muted">Screenshots, recordings, transcripts, and agent evidence files.</p>
            </div>
          </div>
          {mediaArtifacts.length > 0 ? (
            <div className="artifact-list">
              {mediaArtifacts.map((artifact) => (
                <ArtifactRow artifact={artifact} key={artifact.id} />
              ))}
            </div>
          ) : (
            <EmptySection label="No media artifacts attached." />
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Diagnosis and hypotheses</h2>
            <p className="muted">Role-aware diagnosis plus the agent handoff candidates.</p>
          </div>
        </div>
        {diagnosis ? (
          <>
            <div className="diagnosis-summary">
              <strong>{diagnosis.symptom}</strong>
              <p className="muted">{diagnosis.role_lens}</p>
              {diagnosis.evidence && diagnosis.evidence.length > 0 && (
                <ul className="evidence-list">
                  {diagnosis.evidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Hypothesis</th><th>Confidence</th><th>Reproduction plan</th><th>Expected failure</th><th>Status</th></tr></thead>
                <tbody>
                  {hypotheses.map((hypothesis) => (
                    <tr key={hypothesis.id}>
                      <td><strong>{hypothesis.title}</strong></td>
                      <td>{Math.round(hypothesis.confidence * 100)}%</td>
                      <td>{hypothesis.reproduction_plan}</td>
                      <td className="muted">{hypothesis.expected_failure}</td>
                      <td><span className={`status-pill ${statusTone(hypothesis.status)}`}>{statusLabel(hypothesis.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptySection label="No diagnosis generated yet." />
        )}
      </section>

      <div className="detail-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Agent evidence</h2>
              <p className="muted">Sandbox logs and reproduction/fix result returned by Replicas or scripted mode.</p>
            </div>
          </div>
          {agentRuns.length > 0 ? (
            <div className="agent-list">
              {agentRuns.map((agentRun) => (
                <article className="proof-row" key={agentRun.id}>
                  <div className="section-heading tight">
                    <div>
                      <strong>{agentRun.provider}</strong>
                      <p className="muted">{formatDate(agentRun.created_at)} - {formatDate(agentRun.completed_at)}</p>
                    </div>
                    <span className={`status-pill ${statusTone(agentRun.status)}`}>{statusLabel(agentRun.status)}</span>
                  </div>
                  <div className="row">
                    {agentRun.sandbox_url && <a className="link" href={agentRun.sandbox_url}>sandbox</a>}
                    {agentRun.logs_url && <a className="link" href={agentRun.logs_url}>logs</a>}
                  </div>
                  <pre>{prettyJson(agentRun.result)}</pre>
                </article>
              ))}
            </div>
          ) : (
            <EmptySection label="No agent run recorded yet." />
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>PR proof</h2>
              <p className="muted">The demo ends here: a fix PR with root cause and verification.</p>
            </div>
          </div>
          {pullRequest ? (
            <div className="pr-proof">
              <a className="primary-link" href={pullRequest.github_url}>Open pull request</a>
              <dl className="field-list">
                <div><dt>Root cause</dt><dd>{pullRequest.root_cause || '-'}</dd></div>
                <div><dt>Fix summary</dt><dd>{pullRequest.summary}</dd></div>
                <div><dt>Verification</dt><dd>{pullRequest.verification}</dd></div>
                <div><dt>Created</dt><dd>{formatDate(pullRequest.created_at)}</dd></div>
              </dl>
            </div>
          ) : (
            <EmptySection label="No pull request linked yet." />
          )}
        </section>
      </div>

      {intakePackage && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Intake package JSON</h2>
              <p className="muted">Exact confirmed package persisted before diagnosis.</p>
            </div>
            <span className={`status-pill ${statusTone(intakePackage.status)}`}>{statusLabel(intakePackage.status)}</span>
          </div>
          <pre>{prettyJson(intakePackage.confirmed_report)}</pre>
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Timeline</h2>
            <p className="muted">Every state transition written to `run_events`.</p>
          </div>
        </div>
        <Timeline events={events} />
      </section>
    </>
  );
}

/**
 * Renders the confirmed bug report fields.
 *
 * @param props Confirmed brief and optional intake package.
 * @returns Field list for the report section.
 * @sideEffects None.
 */
function ReportFields({
  brief,
  intakePackage
}: {
  brief: DashboardBugBrief;
  intakePackage?: DashboardIntakePackage;
}) {
  const confirmedReport = intakePackage?.confirmed_report ?? {};
  return (
    <dl className="field-list">
      <div><dt>Where</dt><dd>{brief.where_it_happens}</dd></div>
      <div><dt>Actual behavior</dt><dd>{brief.actual_behavior}</dd></div>
      <div><dt>Expected behavior</dt><dd>{brief.expected_behavior ?? stringValue(confirmedReport, 'expectedBehavior') ?? '-'}</dd></div>
      <div><dt>Reproduction context</dt><dd>{brief.reproduction_context ?? stringValue(confirmedReport, 'reproductionContext') ?? '-'}</dd></div>
      <div><dt>Affected surface</dt><dd><span className="pill">{brief.affected_surface}</span></dd></div>
      <div><dt>Missing info</dt><dd>{listText(brief.missing_info)}</dd></div>
    </dl>
  );
}

/**
 * Renders the latest normalized observation.
 *
 * @param props Observation row from InsForge.
 * @returns Observation summary and visible-state JSON.
 * @sideEffects None.
 */
function ObservationView({ observation }: { observation: DashboardObservation }) {
  return (
    <div className="observation-view">
      {observation.transcript && (
        <>
          <h3>Transcript</h3>
          <p>{observation.transcript}</p>
        </>
      )}
      <h3>Visible state</h3>
      <pre>{prettyJson(observation.visible_state)}</pre>
    </div>
  );
}

/**
 * Renders one media artifact row.
 *
 * @param props Artifact row from InsForge.
 * @returns Artifact summary card.
 * @sideEffects None.
 */
function ArtifactRow({ artifact }: { artifact: DashboardMediaArtifact }) {
  const artifactName = artifact.storage_url.split('/').slice(-1)[0];
  return (
    <article className="artifact-row">
      <div>
        <strong>{artifact.kind}</strong>
        <span className="muted">{artifact.source} · {formatDate(artifact.created_at)}</span>
      </div>
      <p>{artifact.summary ?? 'No summary stored.'}</p>
      <code>{artifactName}</code>
    </article>
  );
}

/**
 * Renders the run timeline.
 *
 * @param props Ordered run events.
 * @returns Timeline list.
 * @sideEffects None.
 */
function Timeline({ events }: { events: DashboardRunEvent[] }) {
  if (events.length === 0) return <EmptySection label="No events yet." />;
  return (
    <ul className="timeline">
      {events.map((event) => (
        <li key={event.id}>
          <div>
            <strong>{event.title}</strong>{' '}
            {event.status && <span className={`status-pill ${statusTone(event.status)}`}>{statusLabel(event.status)}</span>}
          </div>
          {event.detail && <div className="muted">{event.detail}</div>}
          <div className="t">{event.event_type} · {formatDate(event.created_at)}</div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders a consistent empty section placeholder.
 *
 * @param props Empty-state label.
 * @returns Empty-state element.
 * @sideEffects None.
 */
function EmptySection({ label }: { label: string }) {
  return (
    <div className="empty-state compact">
      <strong>{label}</strong>
    </div>
  );
}

/**
 * Reads a string field from a confirmed report object.
 *
 * @param record Confirmed report object.
 * @param key Field name.
 * @returns String value when present.
 * @sideEffects None.
 */
function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Formats a list for compact report display.
 *
 * @param values List of strings.
 * @returns Comma-separated list or dash.
 * @sideEffects None.
 */
function listText(values?: string[]): string {
  return values && values.length > 0 ? values.join(', ') : '-';
}
