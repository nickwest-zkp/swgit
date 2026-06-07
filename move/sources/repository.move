module swgit::repository {
    use std::string::String;
    use sui::table;

    const E_NOT_OWNER: u64 = 0;
    const E_NOT_AUTHORIZED_AGENT: u64 = 1;
    const E_PROPOSAL_NOT_FOUND: u64 = 2;

    const AGENT_ROLE_WRITER: u8 = 1;

    public struct Repo has key, store {
        id: UID,
        owner: address,
        name: String,
        heads: table::Table<String, vector<u8>>,
        agents: table::Table<address, u8>,
        proposals: table::Table<String, vector<u8>>,
        storage_epochs: u64,
    }

    public fun create_repo(name: String, storage_epochs: u64, ctx: &mut TxContext) {
        let repo = Repo {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            name,
            heads: table::new<String, vector<u8>>(ctx),
            agents: table::new<address, u8>(ctx),
            proposals: table::new<String, vector<u8>>(ctx),
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

    public fun authorize_agent(repo: &mut Repo, agent: address, ctx: &TxContext) {
        assert!(repo.owner == tx_context::sender(ctx), E_NOT_OWNER);

        if (table::contains(&repo.agents, agent)) {
            *table::borrow_mut(&mut repo.agents, agent) = AGENT_ROLE_WRITER;
        } else {
            table::add(&mut repo.agents, agent, AGENT_ROLE_WRITER);
        };
    }

    public fun revoke_agent(repo: &mut Repo, agent: address, ctx: &TxContext) {
        assert!(repo.owner == tx_context::sender(ctx), E_NOT_OWNER);

        if (table::contains(&repo.agents, agent)) {
            table::remove(&mut repo.agents, agent);
        };
    }

    public fun create_proposal(
        repo: &mut Repo,
        proposal_id: String,
        payload: vector<u8>,
        ctx: &TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(
            repo.owner == sender || table::contains(&repo.agents, sender),
            E_NOT_AUTHORIZED_AGENT,
        );

        if (table::contains(&repo.proposals, copy proposal_id)) {
            *table::borrow_mut(&mut repo.proposals, copy proposal_id) = payload;
        } else {
            table::add(&mut repo.proposals, proposal_id, payload);
        };
    }

    public fun accept_proposal(
        repo: &mut Repo,
        proposal_id: String,
        ref_name: String,
        blob_id: vector<u8>,
        accepted_payload: vector<u8>,
        ctx: &TxContext,
    ) {
        assert!(repo.owner == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(table::contains(&repo.proposals, copy proposal_id), E_PROPOSAL_NOT_FOUND);

        *table::borrow_mut(&mut repo.proposals, proposal_id) = accepted_payload;

        if (table::contains(&repo.heads, copy ref_name)) {
            *table::borrow_mut(&mut repo.heads, copy ref_name) = blob_id;
        } else {
            table::add(&mut repo.heads, ref_name, blob_id);
        };
    }
}
