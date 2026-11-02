import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { meQuery, postForm } from "../api.ts";
import { ProfileForm } from "../components/ProfileForm.tsx";

/** Changing a profile after the account step. Their name on old posts changes along with it. */
export function EditProfilePage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery(meQuery);

  if (!me.data) {
    return null;
  }
  const { username, name, location, bio, pictureUrl } = me.data;

  return (
    <div className="mx-auto max-w-xl bg-white p-6 sm:rounded-lg sm:shadow-sm">
      <h1 className="mb-4 text-xl font-semibold">Edit your profile</h1>
      <ProfileForm
        initial={{ username, name, location, bio }}
        pictureUrl={{ url: pictureUrl, seed: username }}
        submitLabel="Save"
        save={async (fields) => {
          await postForm("/me/profile", { ...fields });
          await client.invalidateQueries();
          await navigate({ to: "/" });
        }}
      >
        <Link to="/" className="px-3 py-2.5 text-sm">
          Cancel
        </Link>
      </ProfileForm>
    </div>
  );
}
