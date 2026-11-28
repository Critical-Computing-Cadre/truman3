import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { usePlatform } from "@truman3/ui";
import { meQuery, postForm } from "../api.ts";
import { BackBar } from "../components/BackBar.tsx";
import { ProfileForm } from "../components/ProfileForm.tsx";

/** Changing a profile after the account step. Their name on old posts changes along with it. */
export function EditProfilePage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery(meQuery);
  // Only profiles that show a banner ask for one.
  const banners = usePlatform().layout === "short-posts";

  if (!me.data) {
    return null;
  }
  const { username, name, location, bio, pictureUrl, bannerUrl } = me.data;

  return (
    <div className="mx-auto max-w-xl">
      <BackBar title="Edit your profile" />
      <div className="bg-white p-6 sm:rounded-lg sm:shadow-sm">
        <ProfileForm
          initial={{ username, name, location, bio }}
          pictureUrl={{ url: pictureUrl, seed: username }}
          {...(banners ? { bannerUrl: { url: bannerUrl } } : {})}
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
    </div>
  );
}
