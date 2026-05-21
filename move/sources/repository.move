module swgit::repository {
    use std::string::String;
    use sui::table;

    const E_NOT_OWNER: u64 = 0;

    public struct Repo has key, store {
        id: UID,
        owner: address,
        name: String,
        heads: table::Table<String, vector<u8>>,
        storage_epochs: u64,
    }

    public fun create_repo(name: String, storage_epochs: u64, ctx: &mut TxContext) {
        let repo = Repo {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            name,
            heads: table::new<String, vector<u8>>(ctx),
            storage_epochs,
        };

        transfer::public_transfer(repo, tx_context::sender(ctx));
    }

    public fun update_ref(
        repo: &mut Repo,
        ref_name: String,
        blob_id: vector<u8>,
        ctx: &TxContext,
    ) {
        assert!(repo.owner == tx_context::sender(ctx), E_NOT_OWNER);

        if (table::contains(&repo.heads, copy ref_name)) {
            *table::borrow_mut(&mut repo.heads, copy ref_name) = blob_id;
        } else {
            table::add(&mut repo.heads, ref_name, blob_id);
        };
    }
}
