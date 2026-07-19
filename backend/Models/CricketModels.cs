namespace Fightclub.Api.Models;

public sealed record Player(
    int Id,
    string Name,
    string Initials,
    string[] Roles,
    string Email,
    string Phone,
    int Runs,
    int Wickets,
    int Catches,
    string Availability,
    string JoinedOn);

public sealed record PlayerLog(int Id, string Name, string Email, string Password);

public sealed record PreviousMatch(
    int Id,
    string Opponent,
    string PlayedOn,
    int OurScore,
    int OpponentScore,
    string Result,
    string Venue);

public sealed record AdminSession(string Name, string Email, string Role, string TeamName);

public sealed record LoginRequest(string Email, string Password);

public sealed record ProfileDetails(string Name, string Email, string Phone, string Timezone);

public sealed record UpdateProfileRequest(string Phone, string Timezone);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword, string ConfirmPassword);

public sealed record UpdateStatRequest(string Stat);

public sealed record UpdatePlayerLogRequest(string Password);
