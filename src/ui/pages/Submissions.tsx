import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Inbox, Reply, Trash } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import type { FormConfig } from "../../config/types.js";
import { ApiError, type Submission } from "../api.js";
import { TopBar } from "../components/Layout.js";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Loading,
  NotFoundState,
  useToast,
} from "../components/ui.js";
import { useVestry } from "../context.js";
import { cx, formatDate, titleCase } from "../lib/utils.js";

/** The form named in the address, if the config has it and the user may read it. */
function useForm(): { key: string; form: FormConfig } | "missing" | "denied" {
  const { config, client } = useVestry();
  const { form: key = "" } = useParams();
  const form =
    config.forms && Object.hasOwn(config.forms, key)
      ? config.forms[key]
      : undefined;
  if (client.user?.role !== "admin") return "denied";
  return form ? { key, form } : "missing";
}

/** The fields a list shows: the form's `columns`, or the first three it holds. */
function submissionColumns(
  form: FormConfig,
  submissions: Submission[],
): string[] {
  if (form.columns?.length) return form.columns;
  return Object.keys(submissions[0]?.data ?? {}).slice(0, 3);
}

/** A submission's heading: its subject, or the first value it has. */
function submissionTitle(s: Submission): string {
  const subject = s.data.subject?.trim();
  if (subject) return subject;
  const first = Object.values(s.data).find((v) => v.trim());
  return first ? first.trim().slice(0, 80) : "Submission";
}

export function SubmissionsPage() {
  const found = useForm();
  const { api } = useVestry();
  const key = typeof found === "object" ? found.key : "";
  const q = useInfiniteQuery({
    queryKey: ["submissions", key],
    queryFn: ({ pageParam }) => api.listSubmissions(key, pageParam),
    initialPageParam: undefined as Submission | undefined,
    getNextPageParam: (last) =>
      last.more ? last.submissions.at(-1) : undefined,
    enabled: typeof found === "object",
  });
  if (found === "denied") return <Navigate to="/" replace />;
  if (found === "missing") return <NotFoundState title="Form not found" />;
  const { form } = found;
  const submissions = q.data?.pages.flatMap((p) => p.submissions) ?? [];
  return (
    <>
      <TopBar title={form.label} crumbs={[{ label: form.label }]} />
      <div className="v-page">
        {q.isLoading ? (
          <Loading label="Loading submissions…" />
        ) : q.error ? (
          <ErrorState
            title="Couldn't load the submissions"
            error={q.error}
            onRetry={() => void q.refetch()}
          />
        ) : submissions.length === 0 ? (
          <div className="v-card">
            <EmptyState icon={<Inbox />} title="No submissions yet">
              <p>What people send with this form on the site shows up here.</p>
            </EmptyState>
          </div>
        ) : (
          <SubmissionTable
            formKey={key}
            form={form}
            submissions={submissions}
          />
        )}
        {q.hasNextPage && (
          <div className="v-load-more">
            <Button
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              Show older submissions
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function SubmissionTable({
  formKey,
  form,
  submissions,
}: {
  formKey: string;
  form: FormConfig;
  submissions: Submission[];
}) {
  const navigate = useNavigate();
  const columns = submissionColumns(form, submissions);
  return (
    <div className="v-card">
      <div className="v-table-wrap">
        <table className="v-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{titleCase(c)}</th>
              ))}
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => {
              const to = `/forms/${formKey}/${encodeURIComponent(s.id)}`;
              return (
                <tr
                  key={s.id}
                  className={cx("v-submission", !s.readAt && "is-unread")}
                  onClick={(e) => {
                    if (isPlainRowClick(e)) void navigate(to);
                  }}
                >
                  {columns.map((c, i) => (
                    <td
                      key={c}
                      className={i === 0 ? "v-table__main" : undefined}
                    >
                      {i === 0 ? (
                        <Link to={to} className="v-table__title">
                          {!s.readAt && (
                            <span className="v-unread-dot" title="Unread" />
                          )}
                          {s.data[c] || "—"}
                        </Link>
                      ) : (
                        <span className="v-submission__cell">
                          {s.data[c] || "—"}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="v-muted" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(s.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Whether a click on a row should open its submission: not one on its link,
 * which opens it already, nor one asking for a new tab or window.
 */
function isPlainRowClick(e: MouseEvent): boolean {
  if (e.target instanceof Element && e.target.closest("a")) return false;
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}

/** A submission and its delete action. */
function useSubmission(key: string, id: string, enabled: boolean) {
  const { api } = useVestry();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["submission", key, id],
    queryFn: async () => {
      const res = await api.getSubmission(key, id);
      // Opening it marked it read.
      void queryClient.invalidateQueries({ queryKey: ["submissions", key] });
      return res;
    },
    enabled,
    // A deleted one stays deleted.
    retry: (failures, e) =>
      failures < 1 && !(e instanceof ApiError && e.status === 404),
  });
  const remove = useMutation({
    mutationFn: () => api.removeSubmission(key, id),
    onSuccess: async () => {
      toast("success", "Submission deleted.");
      queryClient.removeQueries({ queryKey: ["submission", key, id] });
      await queryClient.invalidateQueries({ queryKey: ["submissions", key] });
      await navigate(`/forms/${key}`);
    },
    onError: (e) => toast("error", e instanceof Error ? e.message : String(e)),
  });
  return { q, remove };
}

export function SubmissionPage() {
  const found = useForm();
  const { id = "" } = useParams();
  const [confirming, setConfirming] = useState(false);
  const key = typeof found === "object" ? found.key : "";
  const { q, remove } = useSubmission(key, id, typeof found === "object");
  if (found === "denied") return <Navigate to="/" replace />;
  if (found === "missing") return <NotFoundState title="Form not found" />;
  const submission = q.data?.submission;
  const title = submission ? submissionTitle(submission) : "Submission";
  return (
    <>
      <TopBar
        title={title}
        crumbs={[
          { label: found.form.label, to: `/forms/${key}` },
          { label: title },
        ]}
        actions={
          submission && (
            <SubmissionActions
              submission={submission}
              onDelete={() => setConfirming(true)}
            />
          )
        }
      />
      <div className="v-page">
        <SubmissionBody q={q} />
      </div>
      {confirming && (
        <ConfirmDialog
          title="Delete this submission?"
          message="It is removed for good. A copy that was emailed stays in those inboxes."
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  );
}

/** The submission, or why it isn't shown. */
function SubmissionBody({ q }: { q: ReturnType<typeof useSubmission>["q"] }) {
  const submission = q.data?.submission;
  if (q.isLoading) return <Loading label="Loading the submission…" />;
  if (q.error instanceof ApiError && q.error.status === 404)
    return (
      <NotFoundState title="Submission not found">
        It may have been deleted.
      </NotFoundState>
    );
  if (q.error || !submission)
    return (
      <ErrorState
        title="Couldn't load the submission"
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    );
  return <SubmissionDetail submission={submission} />;
}

function SubmissionActions({
  submission,
  onDelete,
}: {
  submission: Submission;
  onDelete: () => void;
}) {
  const email = submission.data.email?.trim();
  return (
    <>
      {email && (
        <a className="v-btn" href={replyLink(email, submission)}>
          <Reply /> Reply
        </a>
      )}
      <Button variant="danger" onClick={onDelete}>
        <Trash /> Delete
      </Button>
    </>
  );
}

function SubmissionDetail({ submission }: { submission: Submission }) {
  return (
    <div className="v-card v-submission-detail">
      <dl>
        {Object.entries(submission.data).map(([k, v]) => (
          <div key={k}>
            <dt>{titleCase(k)}</dt>
            <dd>{v || "—"}</dd>
          </div>
        ))}
        <div>
          <dt>Received</dt>
          <dd>{formatDate(submission.createdAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** A mailto link answering the submission, with its subject. */
function replyLink(email: string, s: Submission): string {
  const subject = s.data.subject?.trim();
  return `mailto:${encodeURIComponent(email)}${subject ? `?subject=${encodeURIComponent(`Re: ${subject}`)}` : ""}`;
}
