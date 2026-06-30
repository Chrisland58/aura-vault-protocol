# Aura Vault - Rust Integration

## Setup

Add to `Cargo.toml`:

```toml
[dependencies]
soroban-sdk = "21"
stellar-stroop = "0.2"
tokio = { version = "1", features = ["full"] }
```

## Client Initialization

```rust
use soroban_sdk::{Address, Env, Symbol, Val, XdrFromScVal};
use std::str::FromStr;

pub struct AuraVaultClient {
    contract_id: String,
    rpc_url: String,
}

impl AuraVaultClient {
    pub fn new(contract_id: impl Into<String>, rpc_url: impl Into<String>) -> Self {
        Self {
            contract_id: contract_id.into(),
            rpc_url: rpc_url.into(),
        }
    }
}
```

## Initialize Vault

```rust
impl AuraVaultClient {
    pub async fn initialize(
        &self,
        admin: &str,
        underlying_token: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let admin_addr = Address::from_str(admin)?;
        let token_addr = Address::from_str(underlying_token)?;

        let payload = vec![
            Symbol::new(&self.env, "initialize"),
            admin_addr.to_xdr_val(&self.env),
            token_addr.to_xdr_val(&self.env),
        ];

        self.call_contract(payload).await
    }

    async fn call_contract(&self, payload: Vec<Val>) -> Result<String, Box<dyn std::error::Error>> {
        let client = reqwest::Client::new();
        let resp = client
            .post(&self.rpc_url)
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": {
                    "transaction": format!("{:?}", payload),
                }
            }))
            .send()
            .await?;

        let result = resp.json::<serde_json::Value>().await?;
        Ok(result["result"]["hash"].to_string())
    }
}
```

## Deposit

```rust
impl AuraVaultClient {
    pub async fn deposit(
        &self,
        caller: &str,
        amount: i128,
    ) -> Result<i128, Box<dyn std::error::Error>> {
        let caller_addr = Address::from_str(caller)?;

        let payload = vec![
            Symbol::new(&self.env, "deposit"),
            caller_addr.to_xdr_val(&self.env),
            amount.to_xdr_val(&self.env),
        ];

        let tx_hash = self.call_contract(payload).await?;
        println!("Deposit TX: {}", tx_hash);

        // Parse result to extract shares minted
        self.get_last_result().await
    }

    async fn get_last_result(&self) -> Result<i128, Box<dyn std::error::Error>> {
        // Query contract state to get result
        // This is simplified; actual implementation would parse XDR
        Ok(0)
    }
}
```

## Withdraw

```rust
impl AuraVaultClient {
    pub async fn withdraw(
        &self,
        caller: &str,
        shares: i128,
    ) -> Result<i128, Box<dyn std::error::Error>> {
        let caller_addr = Address::from_str(caller)?;

        let payload = vec![
            Symbol::new(&self.env, "withdraw"),
            caller_addr.to_xdr_val(&self.env),
            shares.to_xdr_val(&self.env),
        ];

        let tx_hash = self.call_contract(payload).await?;
        println!("Withdraw TX: {}", tx_hash);

        self.get_last_result().await
    }
}
```

## Harvest Yield

```rust
impl AuraVaultClient {
    pub async fn harvest(
        &self,
        caller: &str,
        yield_amount: i128,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let caller_addr = Address::from_str(caller)?;

        let payload = vec![
            Symbol::new(&self.env, "harvest"),
            caller_addr.to_xdr_val(&self.env),
            yield_amount.to_xdr_val(&self.env),
        ];

        self.call_contract(payload).await
    }
}
```

## Query Total Assets

```rust
impl AuraVaultClient {
    pub async fn get_total_assets(&self) -> Result<i128, Box<dyn std::error::Error>> {
        let payload = vec![
            Symbol::new(&self.env, "total_assets"),
        ];

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.rpc_url)
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "simulateTransaction",
                "params": {
                    "transaction": format!("{:?}", payload),
                }
            }))
            .send()
            .await?;

        let result = resp.json::<serde_json::Value>().await?;
        let total = result["result"]["retval"]["i128"]["value"]
            .as_i64()
            .ok_or("Failed to parse total_assets")?;

        Ok(total as i128)
    }
}
```

## Query Share Balance

```rust
impl AuraVaultClient {
    pub async fn get_balance(&self, address: &str) -> Result<i128, Box<dyn std::error::Error>> {
        let user_addr = Address::from_str(address)?;

        let payload = vec![
            Symbol::new(&self.env, "balance_of"),
            user_addr.to_xdr_val(&self.env),
        ];

        let client = reqwest::Client::new();
        let resp = client
            .post(&self.rpc_url)
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "simulateTransaction",
                "params": {
                    "transaction": format!("{:?}", payload),
                }
            }))
            .send()
            .await?;

        let result = resp.json::<serde_json::Value>().await?;
        let balance = result["result"]["retval"]["i128"]["value"]
            .as_i64()
            .ok_or("Failed to parse balance_of")?;

        Ok(balance as i128)
    }
}
```

## Error Handling

```rust
#[derive(Debug)]
pub enum VaultError {
    NotInitialized,
    AlreadyInitialized,
    InsufficientShares,
    InsufficientUnderlying,
    ZeroAmount,
    MathOverflow,
    InvalidAddress,
    ZeroShares,
    UpgradeUnauthorized,
    StorageLayoutMismatch,
    Unknown(i32),
}

impl From<i32> for VaultError {
    fn from(code: i32) -> Self {
        match code {
            1 => VaultError::NotInitialized,
            2 => VaultError::AlreadyInitialized,
            3 => VaultError::InsufficientShares,
            4 => VaultError::InsufficientUnderlying,
            5 => VaultError::ZeroAmount,
            6 => VaultError::MathOverflow,
            7 => VaultError::InvalidAddress,
            8 => VaultError::ZeroShares,
            9 => VaultError::UpgradeUnauthorized,
            10 => VaultError::StorageLayoutMismatch,
            _ => VaultError::Unknown(code),
        }
    }
}

pub async fn deposit_with_error_handling(
    client: &AuraVaultClient,
    caller: &str,
    amount: i128,
) -> Result<i128, VaultError> {
    match client.deposit(caller, amount).await {
        Ok(shares) => Ok(shares),
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("1") {
                Err(VaultError::NotInitialized)
            } else if error_msg.contains("5") {
                Err(VaultError::ZeroAmount)
            } else if error_msg.contains("6") {
                Err(VaultError::MathOverflow)
            } else {
                Err(VaultError::Unknown(-1))
            }
        }
    }
}
```

## Complete Example

```rust
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let vault = AuraVaultClient::new(
        "CABC123...",
        "https://soroban-testnet.stellar.org/",
    );

    // Initialize
    let init_tx = vault
        .initialize("GADMIN...", "CTOKEN...")
        .await?;
    println!("Initialized: {}", init_tx);

    // Deposit 1,000,000 tokens
    let shares = vault
        .deposit("GUSER...", 1_000_000)
        .await?;
    println!("Shares minted: {}", shares);

    // Check balance
    let balance = vault.get_balance("GUSER...").await?;
    println!("Your shares: {}", balance);

    // Check total assets
    let total = vault.get_total_assets().await?;
    println!("Total assets: {}", total);

    // Harvest 100k yield
    let harvest_tx = vault
        .harvest("GKEEPER...", 100_000)
        .await?;
    println!("Harvest TX: {}", harvest_tx);

    Ok(())
}
```

## Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_deposit() {
        let vault = AuraVaultClient::new("CABC...", "https://soroban-testnet.stellar.org/");
        let shares = vault.deposit("GUSER...", 1_000_000).await;
        assert!(shares.is_ok());
    }

    #[tokio::test]
    async fn test_get_balance() {
        let vault = AuraVaultClient::new("CABC...", "https://soroban-testnet.stellar.org/");
        let balance = vault.get_balance("GUSER...").await;
        assert!(balance.is_ok());
    }

    #[tokio::test]
    async fn test_withdraw() {
        let vault = AuraVaultClient::new("CABC...", "https://soroban-testnet.stellar.org/");
        let result = vault.withdraw("GUSER...", 500_000).await;
        assert!(result.is_ok());
    }
}
```
