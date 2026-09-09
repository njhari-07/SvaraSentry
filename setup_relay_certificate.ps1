param(
    [Parameter(Mandatory = $true)]
    [string]$PublicHost,
    [string]$OutputDirectory = "certificates"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = $PSScriptRoot
$outputRoot = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory
} else {
    Join-Path $repositoryRoot $OutputDirectory
}
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null

$caKey = [Security.Cryptography.RSA]::Create(3072)
$caRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=SvaraSentry Local Development CA",
    $caKey,
    [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1
)
$caRequest.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true)
)
$caRequest.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor
        [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign,
        $true
    )
)
$now = [DateTimeOffset]::UtcNow
$caCertificate = $caRequest.CreateSelfSigned($now.AddDays(-1), $now.AddYears(2))

$serverKey = [Security.Cryptography.RSA]::Create(2048)
$serverRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=$PublicHost",
    $serverKey,
    [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1
)
$serverRequest.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new(
        $false, $false, 0, $true
    )
)
$serverRequest.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,
        $true
    )
)
$serverUsages = [Security.Cryptography.OidCollection]::new()
[void]$serverUsages.Add([Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.1"))
$serverRequest.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new(
        $serverUsages, $false
    )
)
$san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$address = $null
if ([Net.IPAddress]::TryParse($PublicHost, [ref]$address)) {
    $san.AddIpAddress($address)
} else {
    $san.AddDnsName($PublicHost)
}
$san.AddDnsName("localhost")
$san.AddIpAddress([Net.IPAddress]::Loopback)
$serverRequest.CertificateExtensions.Add($san.Build())

$serial = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
$serial[0] = $serial[0] -band 0x7F
$issued = $serverRequest.Create($caCertificate, $now.AddDays(-1), $now.AddYears(1), $serial)
$serverCertificate = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey(
    $issued,
    $serverKey
)

$caPath = Join-Path $outputRoot "svarasentry-ca.pem"
$certificatePath = Join-Path $outputRoot "svarasentry.pem"
$privateKeyPath = Join-Path $outputRoot "svarasentry-key.pem"
[IO.File]::WriteAllText($caPath, $caCertificate.ExportCertificatePem())
[IO.File]::WriteAllText($certificatePath, $serverCertificate.ExportCertificatePem())
[IO.File]::WriteAllText($privateKeyPath, $serverKey.ExportPkcs8PrivateKeyPem())

Write-Host "Created relay certificate for $PublicHost"
Write-Host "CA certificate: $caPath"
Write-Host "Server certificate: $certificatePath"
Write-Host "Private key: $privateKeyPath"
Write-Host "Trust only the CA certificate on the laptop and phone; never copy or trust the private key."
