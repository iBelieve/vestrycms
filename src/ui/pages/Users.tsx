import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Mail, Plus, Trash, UserCog } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import type { PublicUser, Role } from "../api.js";
import { ROLES } from "../../core/roles.js";
import { TopBar } from "../components/Layout.js";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Loading,
  Menu,
  Modal,
  Spinner,
  useToast,
} from "../components/ui.js";
import { useVestry } from "../context.js";
import { cx, formatDate, initials } from "../lib/utils.js";

export function UsersPage() {
  const { api, client, refresh } = useVestry();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = client.user!;
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [removing, setRemoving] = useState<PublicUser | null>(null);

  const q = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: me.role === "admin" && client.auth,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["users"] });

  const resend = useMutation({
    mutationFn: (u: PublicUser) => api.resendInvite(u.id),
    onSuccess: (_r, u) => toast("success", `Invitation re-sent to ${u.email}.`),
    onError: (e) => toast("error", message(e)),
  });
  const remove = useMutation({
    mutationFn: (u: PublicUser) => api.removeUser(u.id),
    onSuccess: (_r, u) => {
      toast("success", `${u.name} was removed.`);
      setRemoving(null);
      invalidate();
    },
    onError: (e) => toast("error", message(e)),
  });

  if (me.role !== "admin") return <Navigate to="/" replace />;

  const crumbs = [{ label: "Users" }];

  return (
    <>
      <TopBar
        title="Users"
        crumbs={crumbs}
        actions={
          client.auth && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <Plus /> Invite user
            </Button>
          )
        }
      />
      <div className="v-page">
        <UsersBody
          auth={client.auth}
          query={q}
          meId={me.id}
          onEdit={setEditing}
          onResend={(u) => resend.mutate(u)}
          onRemove={setRemoving}
        />
      </div>

      {inviting && (
        <UserForm
          title="Invite user"
          submitLabel="Send invitation"
          onClose={() => setInviting(false)}
          onSubmit={async (values) => {
            const { user, mailError } = await api.inviteUser(values);
            if (mailError) {
              toast(
                "error",
                `${user.name} was added, but the invitation email failed: ${mailError}. Use "Re-send invitation" once email is working.`,
              );
            } else {
              toast("success", `Invitation sent to ${user.email}.`);
            }
            setInviting(false);
            invalidate();
          }}
        />
      )}
      {editing && (
        <UserForm
          title={`Edit ${editing.name}`}
          submitLabel="Save"
          user={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await api.updateUser(editing.id, {
              name: values.name,
              role: values.role,
            });
            toast("success", "User updated.");
            setEditing(null);
            invalidate();
            if (editing.id === me.id) await refresh();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          message={`${removing.email} will no longer be able to sign in. Content they created stays as it is.`}
          confirmLabel="Remove"
          danger
          busy={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing)}
        />
      )}
    </>
  );
}

function UserForm({
  title,
  submitLabel,
  user,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  user?: PublicUser;
  onClose: () => void;
  onSubmit: (values: {
    email: string;
    name: string;
    role: Role;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ email, name, role });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="v-user-form"
            disabled={busy || (!user && !email)}
          >
            {busy ? <Spinner /> : null}
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="v-user-form" onSubmit={submit} className="v-fields">
        {!user && <EmailField email={email} onEmail={setEmail} />}
        <label className="v-field">
          <span className="v-field__label">Name</span>
          <input
            className="v-input"
            type="text"
            autoFocus={!!user}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={user ? undefined : "Optional"}
          />
        </label>
        <RoleField
          role={role}
          onRole={setRole}
          locked={user?.origin === "config"}
        />
        {error && <Alert kind="error">{error}</Alert>}
      </form>
    </Modal>
  );
}

type UserActions = {
  onEdit: (u: PublicUser) => void;
  onResend: (u: PublicUser) => void;
  onRemove: (u: PublicUser) => void;
};

/** The page body: the user table, or why there isn't one. */
function UsersBody({
  auth,
  query,
  meId,
  ...actions
}: {
  auth: boolean;
  query: { isLoading: boolean; error: unknown; data?: { users: PublicUser[] } };
  meId: string;
} & UserActions) {
  if (!auth) {
    return (
      <Alert kind="info">
        Sign-in is off in local mode, so there are no users to manage. Start the
        dev server with <code>VESTRY_MODE=auth</code> to work on sign-in and
        users locally.
      </Alert>
    );
  }
  if (query.isLoading) return <Loading label="Loading users…" />;
  if (query.error) return <Alert kind="error">{message(query.error)}</Alert>;
  const users = query.data?.users ?? [];
  if (users.length === 0) {
    return (
      <div className="v-card">
        <EmptyState icon={<UserCog />} title="No users yet">
          <p>Invite the people who should be able to edit the site.</p>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="v-card">
      <div className="v-table-wrap">
        <table className="v-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} isMe={u.id === meId} {...actions} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({
  user: u,
  isMe,
  ...actions
}: { user: PublicUser; isMe: boolean } & UserActions) {
  return (
    <tr>
      <td className="v-table__main">
        <span className="v-user">
          <span className="v-avatar" aria-hidden>
            {initials(u.name || u.email)}
          </span>
          <span className="v-user__text">
            <span className="v-table__title">
              {u.name}
              {isMe && <span className="v-muted"> (you)</span>}
            </span>
            <span className="v-table__sub">{u.email}</span>
          </span>
        </span>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {roleLabel(u.role)}
        {u.origin === "config" && (
          <span
            className="v-muted"
            title="Listed in auth.admins in vestry.config"
          >
            {" "}
            · config
          </span>
        )}
      </td>
      <td>
        {u.status === "active" ? (
          <Badge status="published">Active</Badge>
        ) : (
          <Badge status="draft">Invited</Badge>
        )}
      </td>
      <td className="v-muted" style={{ whiteSpace: "nowrap" }}>
        {u.lastLoginAt ? formatDate(u.lastLoginAt) : "—"}
      </td>
      <td className="v-table__actions">
        <UserMenu
          user={u}
          canRemove={!isMe && u.origin !== "config"}
          {...actions}
        />
      </td>
    </tr>
  );
}

function UserMenu({
  user: u,
  canRemove,
  onEdit,
  onResend,
  onRemove,
}: { user: PublicUser; canRemove: boolean } & UserActions) {
  return (
    <Menu
      align="right"
      trigger={({ toggle }) => (
        <Button variant="ghost" size="xs" icon title="Actions" onClick={toggle}>
          <Ellipsis />
        </Button>
      )}
    >
      {(close) => (
        <>
          <button
            className="v-menu__item"
            onClick={() => {
              close();
              onEdit(u);
            }}
          >
            <UserCog />
            <span>Edit name and role</span>
          </button>
          {u.status === "invited" && (
            <button
              className="v-menu__item"
              onClick={() => {
                close();
                onResend(u);
              }}
            >
              <Mail />
              <span>Re-send invitation</span>
            </button>
          )}
          {canRemove && (
            <button
              className="v-menu__item v-menu__item--danger"
              onClick={() => {
                close();
                onRemove(u);
              }}
            >
              <Trash />
              <span>Remove</span>
            </button>
          )}
        </>
      )}
    </Menu>
  );
}

function EmailField({
  email,
  onEmail,
}: {
  email: string;
  onEmail: (email: string) => void;
}) {
  return (
    <label className="v-field">
      <span className="v-field__label">Email</span>
      <input
        className="v-input"
        type="email"
        autoFocus
        required
        value={email}
        onChange={(e) => onEmail(e.target.value)}
        placeholder="colleague@example.org"
      />
      <span className="v-field__hint">
        They'll get an email with a link to sign in. No password needed: we
        email a code each time.
      </span>
    </label>
  );
}

/** The role picker; `locked` for a config admin, who is always an admin. */
function RoleField({
  role,
  onRole,
  locked,
}: {
  role: Role;
  onRole: (role: Role) => void;
  locked: boolean;
}) {
  return (
    <div className="v-field">
      <span className="v-field__label">Role</span>
      <div className="v-radio-cards">
        {ROLES.map((r) => (
          <label
            key={r.value}
            className={cx(
              "v-radio-card",
              role === r.value && "is-selected",
              locked && "is-disabled",
            )}
          >
            <input
              type="radio"
              name="role"
              value={r.value}
              checked={role === r.value}
              disabled={locked}
              onChange={() => onRole(r.value)}
            />
            <span className="v-radio-card__body">
              <span className="v-radio-card__label">{r.label}</span>
              <span className="v-radio-card__desc">{r.description}</span>
            </span>
          </label>
        ))}
      </div>
      {locked && (
        <span className="v-field__hint">
          This address is listed in <code>auth.admins</code> in the Vestry
          config, so it is always an admin.
        </span>
      )}
    </div>
  );
}

function roleLabel(role: Role): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
